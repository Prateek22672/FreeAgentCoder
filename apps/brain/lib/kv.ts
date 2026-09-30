import 'server-only';

/**
 * A small store for settings and counts that have to survive a deploy.
 *
 * Backed by Supabase when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set
 * (run supabase/schema.sql in the project once), otherwise by any
 * Upstash-compatible Redis REST endpoint when KV_REST_API_URL and
 * KV_REST_API_TOKEN are set, and otherwise by this process's memory, so
 * development works with no service attached. Nothing here holds anything
 * personal: counts, provider names, a random install id, and pool keys that
 * are encrypted before they arrive.
 */

// Vercel's Upstash integration sets the KV_ names; a database made at
// upstash.com gives the UPSTASH_REDIS_REST_ names. Either works.
const URL_BASE = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)?.trim().replace(/\/$/, '');
const TOKEN = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)?.trim();

const SUPABASE_URL = process.env.SUPABASE_URL?.trim().replace(/\/$/, '');
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)?.trim();
const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);
const redisConfigured = Boolean(URL_BASE && TOKEN);

export const kvConfigured = supabaseConfigured || redisConfigured;
/** Which store is in use, for the admin page. */
export const storeName = supabaseConfigured ? 'Supabase' : redisConfigured ? 'Upstash Redis' : 'memory';

/**
 * On a real deployment, memory is not storage: each request can land on a
 * different short-lived instance, so anything saved there is lost within
 * minutes. Settings the admin saves (keys, plans, specialists) are refused
 * there until a store is connected, rather than silently thrown away.
 */
export const settingsNeedStore = !kvConfigured && Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');
export const NO_STORE_MESSAGE =
    'Not saved: this deployment has no storage connected, so it would be lost within minutes. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see the note on this page), redeploy, then save again.';

export interface Store {
    /** Adds to several counters under one key, and keeps the key for `ttl` seconds. */
    addCounts(key: string, counts: Record<string, number>, ttl: number): Promise<void>;
    counts(key: string): Promise<Record<string, number>>;
    addMember(key: string, member: string, ttl: number): Promise<void>;
    memberCount(key: string): Promise<number>;
    members(key: string, limit: number): Promise<string[]>;
    put(key: string, value: string, ttl: number): Promise<void>;
    getMany(keys: string[]): Promise<(string | null)[]>;
    /** True the first time it is called for `key` within `ttl` seconds. */
    firstIn(key: string, ttl: number): Promise<boolean>;
}

type Command = (string | number)[];

async function send(commands: Command[]): Promise<unknown[]> {
    const response = await fetch(`${URL_BASE}/pipeline`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify(commands),
        cache: 'no-store',
    });
    if (!response.ok) {
        throw new Error(`store: HTTP ${response.status}`);
    }
    const results = (await response.json()) as { result?: unknown; error?: string }[];
    return results.map((entry) => (entry.error ? null : entry.result));
}

function toCounts(value: unknown): Record<string, number> {
    const counts: Record<string, number> = {};
    // Upstash returns a hash as a flat array of field, value, field, value.
    if (Array.isArray(value)) {
        for (let i = 0; i + 1 < value.length; i += 2) {
            counts[String(value[i])] = Number(value[i + 1]) || 0;
        }
        return counts;
    }
    if (value && typeof value === 'object') {
        for (const [field, count] of Object.entries(value)) {
            counts[field] = Number(count) || 0;
        }
    }
    return counts;
}

const remote: Store = {
    async addCounts(key, counts, ttl) {
        const commands: Command[] = Object.entries(counts)
            .filter(([, by]) => by !== 0)
            .map(([field, by]) => ['HINCRBY', key, field, Math.round(by)]);
        if (!commands.length) return;
        commands.push(['EXPIRE', key, ttl]);
        await send(commands);
    },
    async counts(key) {
        const [value] = await send([['HGETALL', key]]);
        return toCounts(value);
    },
    async addMember(key, member, ttl) {
        await send([
            ['SADD', key, member],
            ['EXPIRE', key, ttl],
        ]);
    },
    async memberCount(key) {
        const [value] = await send([['SCARD', key]]);
        return Number(value) || 0;
    },
    async members(key, limit) {
        const [value] = await send([['SRANDMEMBER', key, limit]]);
        return Array.isArray(value) ? value.map(String) : [];
    },
    async put(key, value, ttl) {
        await send([['SET', key, value, 'EX', ttl]]);
    },
    async getMany(keys) {
        if (!keys.length) return [];
        const [value] = await send([['MGET', ...keys]]);
        return Array.isArray(value) ? value.map((entry) => (entry === null || entry === undefined ? null : String(entry))) : keys.map(() => null);
    },
    async firstIn(key, ttl) {
        const [value] = await send([['SET', key, '1', 'EX', ttl, 'NX']]);
        return value !== null;
    },
};

/**
 * Supabase: one Postgres function per operation, in supabase/schema.sql,
 * called through the project's REST API with the secret key. A failed call
 * throws, like the Redis store, so a save is never reported as done when it
 * was not.
 */
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const headers: Record<string, string> = { apikey: SUPABASE_KEY!, 'content-type': 'application/json' };
    // The older service_role key is a JWT and goes in Authorization too; the
    // newer sb_secret_ keys go in apikey alone.
    if (SUPABASE_KEY!.startsWith('eyJ')) headers.authorization = `Bearer ${SUPABASE_KEY}`;
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args), cache: 'no-store' });
    if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 200);
        throw new Error(`store: ${fn} HTTP ${response.status}${detail ? ` ${detail}` : ''}`);
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
}

const supabase: Store = {
    async addCounts(key, counts, ttl) {
        const clean = Object.fromEntries(Object.entries(counts).filter(([, by]) => by !== 0).map(([field, by]) => [field, Math.round(by)]));
        if (!Object.keys(clean).length) return;
        await rpc('fac_kv_add_counts', { p_key: key, p_counts: clean, p_ttl: ttl });
    },
    async counts(key) {
        return toCounts(await rpc<Record<string, number>>('fac_kv_counts', { p_key: key }));
    },
    async addMember(key, member, ttl) {
        await rpc('fac_kv_add_member', { p_key: key, p_member: member, p_ttl: ttl });
    },
    async memberCount(key) {
        return Number(await rpc('fac_kv_member_count', { p_key: key })) || 0;
    },
    async members(key, limit) {
        const rows = await rpc<unknown[]>('fac_kv_members_of', { p_key: key, p_limit: limit });
        return Array.isArray(rows) ? rows.map((row) => (typeof row === 'string' ? row : String((row as Record<string, unknown>).fac_kv_members_of ?? ''))) : [];
    },
    async put(key, value, ttl) {
        await rpc('fac_kv_put', { p_key: key, p_value: value, p_ttl: Math.max(1, Math.round(ttl)) });
    },
    async getMany(keys) {
        if (!keys.length) return [];
        const rows = await rpc<{ k: string; v: string | null }[]>('fac_kv_get_many', { p_keys: keys });
        const found = new Map((rows ?? []).map((row) => [row.k, row.v]));
        return keys.map((key) => found.get(key) ?? null);
    },
    async firstIn(key, ttl) {
        return Boolean(await rpc('fac_kv_first_in', { p_key: key, p_ttl: ttl }));
    },
};

interface Entry {
    value: unknown;
    expires: number;
}

const globalMemory = globalThis as unknown as { __stats?: Map<string, Entry> };
const memoryMap = (globalMemory.__stats ??= new Map());

function read<T>(key: string, fallback: T): T {
    const entry = memoryMap.get(key);
    if (!entry || entry.expires < Date.now()) {
        memoryMap.delete(key);
        return fallback;
    }
    return entry.value as T;
}

function write(key: string, value: unknown, ttl: number): void {
    memoryMap.set(key, { value, expires: Date.now() + ttl * 1000 });
    if (memoryMap.size > 5_000) {
        const now = Date.now();
        for (const [k, entry] of memoryMap) if (entry.expires < now) memoryMap.delete(k);
    }
}

const memory: Store = {
    async addCounts(key, counts, ttl) {
        const current = read<Record<string, number>>(key, {});
        for (const [field, by] of Object.entries(counts)) current[field] = (current[field] ?? 0) + Math.round(by);
        write(key, current, ttl);
    },
    async counts(key) {
        return { ...read<Record<string, number>>(key, {}) };
    },
    async addMember(key, member, ttl) {
        const set = read<Set<string>>(key, new Set());
        set.add(member);
        write(key, set, ttl);
    },
    async memberCount(key) {
        return read<Set<string>>(key, new Set()).size;
    },
    async members(key, limit) {
        return [...read<Set<string>>(key, new Set())].slice(0, limit);
    },
    async put(key, value, ttl) {
        write(key, value, ttl);
    },
    async getMany(keys) {
        return keys.map((key) => read<string | null>(key, null));
    },
    async firstIn(key, ttl) {
        if (read<string | null>(key, null) !== null) return false;
        write(key, '1', ttl);
        return true;
    },
};

export const store: Store = supabaseConfigured ? supabase : redisConfigured ? remote : memory;
