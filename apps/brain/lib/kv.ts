import 'server-only';

/**
 * A small store for counts that have to survive a deploy.
 *
 * Backed by any Upstash-compatible Redis REST endpoint (Vercel KV is one) when
 * KV_REST_API_URL and KV_REST_API_TOKEN are set, and by this process's memory
 * when they are not, so development and preview deployments work with no
 * service attached. Nothing here holds anything personal: counts, provider
 * names and a random install id.
 */

const URL_BASE = process.env.KV_REST_API_URL?.replace(/\/$/, '');
const TOKEN = process.env.KV_REST_API_TOKEN;

export const kvConfigured = Boolean(URL_BASE && TOKEN);

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

export const store: Store = kvConfigured ? remote : memory;
