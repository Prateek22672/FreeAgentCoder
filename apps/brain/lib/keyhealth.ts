import 'server-only';
import { PRESETS } from '@agentic/core';

/**
 * Asks a provider whether a key works.
 *
 * The light check spends no quota: it lists the key's models (or, for
 * OpenRouter, reads the key's own record), which providers do not count as a
 * request. It proves the key is valid, not that it has requests left.
 *
 * The deep check, run when the admin presses Check, then sends one real
 * request with a one-token answer. That proves the key answers right now, and
 * most providers reply with headers saying how much of the quota is left.
 */

export type HealthState = 'ok' | 'invalid' | 'limited' | 'error';

export interface Health {
    state: HealthState;
    message: string;
    at: number;
    ms?: number;
    /** What the provider said about this key's limits, e.g. "998 of 1,000 requests left". */
    limits?: string[];
    /** True when a real request was sent, not just the model list. */
    deep?: boolean;
    /** When the limits shown were read, if earlier than `at`. */
    limitsAt?: number;
}

/**
 * The free tiers' published limits, as our free API limits guide states them,
 * for when a provider sends no live figures. Kept in step with that guide.
 */
export const PUBLISHED_LIMITS: Record<string, string> = {
    gemini: 'Google no longer publishes free-tier limits; AI Studio shows this key\'s',
    groq: 'Free tier: 1,000 requests a day, 30 a minute, 200,000 tokens a day',
    openrouter: 'Free models: 20 a minute; 50 a day, or 1,000 a day after $10 of credits',
    mistral: 'Shown only in your Mistral account, under API > Limits',
    cerebras: 'Paid: the $5 trial needs a card and expires after 30 days',
    openai: 'Paid: set by your account\'s usage tier',
    anthropic: 'Paid: set by your account\'s usage tier',
};

const number = (value: string) => (Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US') : value);

/**
 * Reads rate-limit headers in both common shapes, x-ratelimit-remaining-requests
 * (OpenAI, Groq and others) and anthropic-ratelimit-requests-remaining, into
 * lines such as "998 of 1,000 requests left".
 */
/** What the bare "requests" and "tokens" headers count, where a provider leaves the window unsaid. */
const WINDOWS: Record<string, Record<string, string>> = {
    groq: { requests: 'requests a day', tokens: 'tokens a minute' },
    openai: { requests: 'requests a minute', tokens: 'tokens a minute' },
    anthropic: { requests: 'requests a minute', tokens: 'tokens a minute' },
};

export function limitsFromHeaders(headers: Headers, provider = ''): string[] {
    const found = new Map<string, { limit?: string; remaining?: string }>();
    headers.forEach((value, name) => {
        const key = name.toLowerCase();
        let kind: string | undefined;
        let what: string | undefined;
        const front = /^(?:x|anthropic)-ratelimit-(limit|remaining)-(.+)$/.exec(key);
        const back = /^(?:x|anthropic)-ratelimit-(.+)-(limit|remaining)$/.exec(key);
        if (front) [, kind, what] = front;
        else if (back) [, what, kind] = back;
        if (!kind || !what) return;
        const entry = found.get(what) ?? {};
        entry[kind as 'limit' | 'remaining'] = value;
        found.set(what, entry);
    });
    const lines: string[] = [];
    for (const [what, { limit, remaining }] of found) {
        if (remaining === undefined || limit === undefined) continue;
        const label = WINDOWS[provider]?.[what] ?? what.replace(/-day$/, ' a day').replace(/-minute$/, ' a minute').replace(/-/g, ' ');
        lines.push(`${number(remaining)} of ${number(limit)} ${label} left`);
    }
    return lines;
}

interface Probe {
    url: (key: string) => string;
    headers: (key: string) => Record<string, string>;
}

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

const PROBES: Record<string, Probe> = {
    gemini: { url: (key) => `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(key)}`, headers: () => ({}) },
    groq: { url: () => 'https://api.groq.com/openai/v1/models', headers: bearer },
    mistral: { url: () => 'https://api.mistral.ai/v1/models', headers: bearer },
    openrouter: { url: () => 'https://openrouter.ai/api/v1/key', headers: bearer },
    cerebras: { url: () => 'https://api.cerebras.ai/v1/models', headers: bearer },
    openai: { url: () => 'https://api.openai.com/v1/models', headers: bearer },
    anthropic: { url: () => 'https://api.anthropic.com/v1/models?limit=1', headers: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }) },
};

/** The provider's own words for why it refused, kept short and never echoing the key. */
async function reason(response: Response, key: string): Promise<string> {
    try {
        const body = (await response.json()) as { error?: { message?: string } | string; message?: string };
        const text = typeof body.error === 'string' ? body.error : (body.error?.message ?? body.message ?? '');
        return text.split(key).join('…').slice(0, 160);
    } catch {
        return '';
    }
}

export async function checkKey(provider: string, key: string): Promise<Health> {
    const probe = PROBES[provider];
    const at = Date.now();
    if (!probe) return { state: 'error', message: 'No check for this provider.', at };
    const started = Date.now();
    try {
        const response = await fetch(probe.url(key), { headers: probe.headers(key), cache: 'no-store', signal: AbortSignal.timeout(8_000) });
        const ms = Date.now() - started;
        if (response.ok) {
            if (provider === 'openrouter') {
                const body = (await response.json().catch(() => ({}))) as {
                    data?: { limit?: number | null; limit_remaining?: number | null; usage?: number; is_free_tier?: boolean };
                };
                const data = body.data ?? {};
                const limits = [
                    data.is_free_tier ? 'Free models: 50 requests a day (no $10 of credits bought yet)' : 'Free models: 1,000 requests a day (credits bought)',
                    typeof data.limit === 'number' ? `Credit limit $${data.limit}, $${(data.limit_remaining ?? 0).toFixed(2)} left` : '',
                    typeof data.usage === 'number' ? `Spent so far: $${data.usage.toFixed(2)}` : '',
                ].filter(Boolean);
                const left = data.limit_remaining;
                if (typeof left === 'number' && left <= 0) return { state: 'limited', message: 'Valid, but its credit limit is used up.', at, ms, limits };
                return { state: 'ok', message: 'Valid key', at, ms, limits };
            }
            return { state: 'ok', message: 'Valid key', at, ms, limits: limitsFromHeaders(response.headers, provider) };
        }
        const why = await reason(response, key);
        if (response.status === 429) return { state: 'limited', message: `Valid, but rate limited right now${why ? `: ${why}` : ''}`, at, ms };
        // Gemini answers a bad key with 400 API_KEY_INVALID rather than 401.
        if (response.status === 401 || response.status === 403 || (response.status === 400 && /key/i.test(why))) {
            return { state: 'invalid', message: why || `Rejected by ${provider} (HTTP ${response.status})`, at, ms };
        }
        return { state: 'error', message: `${provider} answered HTTP ${response.status}${why ? `: ${why}` : ''}`, at, ms };
    } catch (error) {
        const timedOut = (error as Error).name === 'TimeoutError';
        return { state: 'error', message: timedOut ? `${provider} did not answer within 8 seconds` : `Could not reach ${provider}`, at };
    }
}

/** One real request with a one-token answer, to prove the key can answer right now. */
async function testRequest(provider: string, key: string): Promise<Health> {
    const preset = PRESETS[provider];
    const at = Date.now();
    if (!preset) return { state: 'error', message: 'No test request for this provider.', at };
    const started = Date.now();
    const anthropic = preset.kind === 'anthropic';
    const url = anthropic ? `${preset.baseURL}/v1/messages` : `${preset.baseURL}/chat/completions`;
    const headers: Record<string, string> = anthropic
        ? { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
        : { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(preset.headers ?? {}) };
    const body = anthropic
        ? { model: preset.defaultModel, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }
        : { model: preset.defaultModel, messages: [{ role: 'user', content: 'hi' }], [preset.maxTokensParam ?? 'max_tokens']: 1 };
    try {
        const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(15_000) });
        const ms = Date.now() - started;
        const limits = limitsFromHeaders(response.headers, provider);
        const why = response.ok ? '' : await reason(response, key);
        if (response.ok) return { state: 'ok', message: `Working: answered a test request in ${(ms / 1000).toFixed(1)} s`, at, ms, limits, deep: true };
        if (response.status === 429) return { state: 'limited', message: `Valid, but out of requests for now${why ? `: ${why}` : ''}`, at, ms, limits, deep: true };
        if (response.status === 401 || response.status === 403) return { state: 'invalid', message: why || `Rejected by ${provider} (HTTP ${response.status})`, at, ms, deep: true };
        return { state: 'error', message: `Valid key, but the test request failed (HTTP ${response.status})${why ? `: ${why}` : ''}`, at, ms, limits, deep: true };
    } catch (error) {
        const timedOut = (error as Error).name === 'TimeoutError';
        return { state: 'error', message: timedOut ? `${provider} did not answer the test request within 15 seconds` : `Could not reach ${provider}`, at, deep: true };
    }
}

/** The light check, then, when it passes, one real request. Keeps what both learned about limits. */
export async function deepCheckKey(provider: string, key: string): Promise<Health> {
    const light = await checkKey(provider, key);
    if (light.state === 'invalid') return light;
    const real = await testRequest(provider, key);
    return { ...real, limits: [...(light.limits ?? []), ...(real.limits ?? [])] };
}
