import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { createProvider, PRESETS, type ChatRequest, type Provider, type RouterEntry, type StreamEvent } from '@agentic/core';
import { store } from './kv';

/**
 * Provider keys added from the admin page, used for the site's free trial.
 *
 * Keys are encrypted before they reach storage (AES-256-GCM, with a key derived
 * from KEY_POOL_SECRET, or ADMIN_PASSWORD when that is not set), so a leaked
 * store does not leak keys. The admin page only ever sees the last four
 * characters. Each key's successes and failures are counted per day, and a key
 * that keeps failing is benched automatically for an hour.
 *
 * The rule this cannot enforce but the admin must keep: one key per provider
 * account. Several free accounts used to multiply a free quota breaks the
 * providers' terms, and gets every one of those keys banned together.
 */

export const POOL_PROVIDERS = ['gemini', 'groq', 'mistral', 'openrouter', 'cerebras', 'openai', 'anthropic'] as const;

interface StoredKey {
    id: string;
    provider: string;
    label: string;
    cipher: string;
    last4: string;
    enabled: boolean;
    addedAt: number;
}

export interface PoolKeyView {
    id: string;
    provider: string;
    label: string;
    last4: string;
    enabled: boolean;
    addedAt: number;
    today: { ok: number; failed: number };
    benched: boolean;
}

const POOL = 'pb:keypool';
const TEN_YEARS = 10 * 365 * 24 * 60 * 60;
const DAY_TTL = 30 * 24 * 60 * 60;
const BENCH_AFTER = 5;
const BENCH_SECONDS = 60 * 60;

function secret(): Buffer | undefined {
    const raw = (process.env.KEY_POOL_SECRET ?? process.env.ADMIN_PASSWORD)?.trim();
    return raw ? createHash('sha256').update(`keypool:${raw}`).digest() : undefined;
}

function encrypt(plain: string): string {
    const key = secret();
    if (!key) throw new Error('Set KEY_POOL_SECRET (or ADMIN_PASSWORD) before adding keys.');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}

function decrypt(sealed: string): string | undefined {
    const key = secret();
    if (!key) return undefined;
    try {
        const [iv, tag, body] = sealed.split('.').map((part) => Buffer.from(part, 'base64url'));
        const decipher = createDecipheriv('aes-256-gcm', key, iv!);
        decipher.setAuthTag(tag!);
        return Buffer.concat([decipher.update(body!), decipher.final()]).toString('utf8');
    } catch {
        // Wrong secret, or tampered with: unusable, never guessed at.
        return undefined;
    }
}

const today = () => new Date().toISOString().slice(0, 10);

async function readPool(): Promise<StoredKey[]> {
    const [raw] = await store.getMany([POOL]);
    try {
        return raw ? (JSON.parse(raw) as StoredKey[]) : [];
    } catch {
        return [];
    }
}

async function writePool(keys: StoredKey[]): Promise<void> {
    await store.put(POOL, JSON.stringify(keys), TEN_YEARS);
    shared.__poolCache = undefined;
}

export async function addPoolKey(provider: string, label: string, key: string): Promise<{ ok: true } | { error: string }> {
    if (!(POOL_PROVIDERS as readonly string[]).includes(provider)) return { error: 'Pick a provider from the list.' };
    const clean = key.trim();
    if (!/^[\x21-\x7e]{16,256}$/.test(clean)) return { error: 'That does not look like an API key. Paste the whole key.' };
    const pool = await readPool();
    if (pool.length >= 50) return { error: 'The pool holds up to 50 keys.' };
    const last4 = clean.slice(-4);
    if (pool.some((k) => k.provider === provider && k.last4 === last4)) return { error: 'That key looks like one already in the pool.' };
    try {
        pool.push({ id: randomUUID(), provider, label: label.trim().slice(0, 40) || provider, cipher: encrypt(clean), last4, enabled: true, addedAt: Date.now() });
    } catch (error) {
        return { error: (error as Error).message };
    }
    await writePool(pool);
    return { ok: true };
}

export async function setPoolKeyEnabled(id: string, enabled: boolean): Promise<void> {
    const pool = await readPool();
    const key = pool.find((k) => k.id === id);
    if (key) {
        key.enabled = enabled;
        await writePool(pool);
    }
}

export async function removePoolKey(id: string): Promise<void> {
    await writePool((await readPool()).filter((k) => k.id !== id));
}

export async function listPool(): Promise<PoolKeyView[]> {
    const [pool, counts] = await Promise.all([readPool(), store.counts(`pb:keyuse:${today()}`)]);
    const benched = await store.getMany(pool.map((k) => `pb:keybench:${k.id}`));
    return pool.map((k, i) => ({
        id: k.id,
        provider: k.provider,
        label: k.label,
        last4: k.last4,
        enabled: k.enabled,
        addedAt: k.addedAt,
        today: { ok: counts[`${k.id}:ok`] ?? 0, failed: counts[`${k.id}:fail`] ?? 0 },
        benched: benched[i] !== null,
    }));
}

/** Watches one key's calls, counting successes and failures and benching it after repeated failures. */
function watched(inner: Provider, id: string): Provider {
    return {
        id: inner.id,
        listModels: (signal) => inner.listModels(signal),
        async *stream(req: ChatRequest): AsyncGenerator<StreamEvent> {
            let finished = false;
            let failed = false;
            try {
                for await (const event of inner.stream(req)) {
                    if (event.type === 'done') finished = true;
                    yield event;
                }
            } catch (error) {
                failed = true;
                throw error;
            } finally {
                if (!req.signal?.aborted) {
                    const ok = finished && !failed;
                    void record(id, ok);
                }
            }
        },
    };
}

async function record(id: string, ok: boolean): Promise<void> {
    try {
        const key = `pb:keyuse:${today()}`;
        await store.addCounts(key, { [`${id}:${ok ? 'ok' : 'fail'}`]: 1 }, DAY_TTL);
        if (!ok) {
            const streak = await store.counts(`pb:keystreak:${id}`);
            const next = (streak.n ?? 0) + 1;
            await store.addCounts(`pb:keystreak:${id}`, { n: 1 }, BENCH_SECONDS);
            if (next >= BENCH_AFTER) {
                await store.put(`pb:keybench:${id}`, '1', BENCH_SECONDS);
                shared.__poolCache = undefined;
            }
        } else {
            await store.put(`pb:keystreak:${id}`, '{}', 1);
        }
    } catch {
        // Counting must never break an answer.
    }
}

// Shared across the separate module copies Next.js makes for routes and
// server actions, so a key added on the admin page clears every copy's cache.
const shared = globalThis as unknown as { __poolCache?: { at: number; entries: RouterEntry[] } };
const CACHE_MS = 60_000;

/** Router entries for every enabled, unbenched pool key. Rebuilt at most once a minute per instance. */
export async function poolEntries(): Promise<RouterEntry[]> {
    const cached = shared.__poolCache;
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.entries;
    const pool = (await readPool()).filter((k) => k.enabled);
    const benched = await store.getMany(pool.map((k) => `pb:keybench:${k.id}`));
    const entries: RouterEntry[] = [];
    pool.forEach((k, i) => {
        if (benched[i] !== null) return;
        const preset = PRESETS[k.provider];
        const apiKey = decrypt(k.cipher);
        if (!preset || !apiKey) return;
        entries.push({
            provider: watched(createProvider(preset, { apiKey, maxOutputTokens: 4_096 }), k.id),
            model: preset.defaultModel,
            contextWindow: preset.contextWindow,
            maxRequestTokens: preset.maxRequestTokens,
            prefer: preset.prefer,
            label: `${preset.label} (${k.label})`,
        });
    });
    shared.__poolCache = { at: Date.now(), entries };
    return entries;
}
