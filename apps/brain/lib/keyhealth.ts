import 'server-only';

/**
 * Asks a provider whether a key works, without spending any of its quota:
 * every check lists the key's models (or, for OpenRouter, reads the key's own
 * record), which providers do not count as a request.
 */

export type HealthState = 'ok' | 'invalid' | 'limited' | 'error';

export interface Health {
    state: HealthState;
    message: string;
    at: number;
    ms?: number;
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
                const body = (await response.json().catch(() => ({}))) as { data?: { limit_remaining?: number | null; is_free_tier?: boolean } };
                const left = body.data?.limit_remaining;
                if (typeof left === 'number' && left <= 0) return { state: 'limited', message: 'Valid, but its credit limit is used up.', at, ms };
                return { state: 'ok', message: body.data?.is_free_tier ? 'Working · free tier' : 'Working', at, ms };
            }
            return { state: 'ok', message: 'Working', at, ms };
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
