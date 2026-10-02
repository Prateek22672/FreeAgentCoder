/**
 * The model chain for Project Brain: the same presets, failover and cooldowns
 * as the VS Code agent, built from whichever free keys are in the environment.
 * Keys stay on the server; the browser only ever sees the answer text.
 *
 * BRAIN_OPENAI_BASE_URL adds any OpenAI-compatible endpoint first in the chain
 * — Ollama, LM Studio or vLLM on this machine, so code never leaves it.
 */
import 'server-only';
import { ModelRouter, OpenAICompatProvider, PRESETS, createProvider, type RouterEntry } from '@agentic/core';
import { outputTokens } from './modelLimits';

/** Large-context providers first: answers are built from many excerpts. */
const ORDER = ['gemini', 'openrouter', 'mistral', 'groq'];

const globalRouter = globalThis as unknown as { __brainRouter?: ModelRouter | null; __brainEntries?: RouterEntry[] };

function customEntry(): RouterEntry | undefined {
    const baseURL = process.env.BRAIN_OPENAI_BASE_URL?.trim();
    const model = process.env.BRAIN_OPENAI_MODEL?.trim();
    if (!baseURL || !model) return undefined;
    const contextWindow = Number(process.env.BRAIN_OPENAI_CONTEXT) || 32_768;
    return {
        provider: new OpenAICompatProvider({ id: 'custom', baseURL, apiKey: process.env.BRAIN_OPENAI_API_KEY || undefined, maxOutputTokens: 8_192 }),
        model,
        contextWindow,
        label: 'Custom endpoint',
    };
}

export function configuredProviders(): string[] {
    const named = ORDER.filter((id) => PRESETS[id]?.keyEnv?.some((name) => process.env[name]));
    return customEntry() ? ['custom', ...named] : named;
}

/** Providers a visitor can bring their own key for. */
export const OWN_KEY_PROVIDERS = ['gemini', 'groq', 'openrouter', 'mistral'] as const;
export type OwnKeyProvider = (typeof OWN_KEY_PROVIDERS)[number];

/**
 * A one-off chain for a visitor's own key, sent with the request. The key is
 * used for this request only: never stored, cached or logged.
 */
/**
 * A one-off chain for a visitor's own keys, sent with the request: every key,
 * in the order that suits each provider, so a key at its limit hands over to
 * the next. Used for this request only: never stored, cached or logged.
 */
export function routerForKeys(list: [string, string][]): ModelRouter | undefined {
    const entries = list
        .filter(([provider, key]) => (OWN_KEY_PROVIDERS as readonly string[]).includes(provider) && /^[\x21-\x7e]{16,256}$/.test(key) && PRESETS[provider])
        .sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]))
        .slice(0, 6)
        .map(([provider, key]) => {
            const preset = PRESETS[provider]!;
            return {
                provider: createProvider(preset, { apiKey: key, maxOutputTokens: outputTokens(preset.id) }),
                model: preset.defaultModel,
                contextWindow: preset.contextWindow,
                maxRequestTokens: preset.maxRequestTokens,
                prefer: preset.prefer,
                label: `your ${preset.label} key`,
            };
        });
    return entries.length ? new ModelRouter(entries) : undefined;
}

/** Reads the visitor's keys from a request: the list when sent, else the single key. */
export function routerFromRequest(request: Request): { router?: ModelRouter; provider?: string; keys: string[] } | undefined {
    const many = request.headers.get('x-brain-keys');
    if (many) {
        try {
            const list = (JSON.parse(many) as unknown[]).filter((x): x is [string, string] => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'string');
            return { router: routerForKeys(list), provider: list[0]?.[0], keys: list.map((x) => x[1]) };
        } catch {
            return { keys: [] };
        }
    }
    const provider = request.headers.get('x-brain-provider');
    const key = request.headers.get('x-brain-key');
    if (provider && key) return { router: routerForKey(provider, key), provider, keys: [key] };
    return undefined;
}

export function routerForKey(provider: string, key: string): ModelRouter | undefined {
    if (!(OWN_KEY_PROVIDERS as readonly string[]).includes(provider)) return undefined;
    if (!/^[\x21-\x7e]{16,256}$/.test(key)) return undefined;
    const preset = PRESETS[provider];
    if (!preset) return undefined;
    return new ModelRouter([
        {
            provider: createProvider(preset, { apiKey: key, maxOutputTokens: outputTokens(preset.id) }),
            model: preset.defaultModel,
            contextWindow: preset.contextWindow,
            maxRequestTokens: preset.maxRequestTokens,
            prefer: preset.prefer,
            label: `your ${preset.label} key`,
        },
    ]);
}

export function providerLabel(id: string): string {
    return PRESETS[id]?.label ?? id;
}

/**
 * The chain for the free trial: keys added on the admin page first, then keys
 * from the environment. Rebuilt only when the pool changes, so the router
 * keeps what it has learned about cooldowns between requests.
 */
let trial: { from: RouterEntry[]; router?: ModelRouter } | undefined;
export async function getTrialRouter(): Promise<ModelRouter | undefined> {
    const { poolEntries } = await import('./keypool');
    const pooled = await poolEntries();
    if (trial && trial.from === pooled) return trial.router ?? getRouter();
    const base = getRouter();
    const envEntries = base ? (globalRouter.__brainEntries ?? []) : [];
    const all = [...pooled, ...envEntries];
    trial = { from: pooled, router: all.length ? new ModelRouter(all) : undefined };
    return trial.router;
}

export function getRouter(): ModelRouter | undefined {
    if (globalRouter.__brainRouter !== undefined) return globalRouter.__brainRouter ?? undefined;
    const entries: RouterEntry[] = [];
    const custom = customEntry();
    if (custom) entries.push(custom);
    for (const id of ORDER) {
        const preset = PRESETS[id];
        const key = preset?.keyEnv?.map((name) => process.env[name]).find(Boolean);
        if (!preset || !key) continue;
        entries.push({
            provider: createProvider(preset, { apiKey: key, maxOutputTokens: outputTokens(preset.id) }),
            model: preset.defaultModel,
            contextWindow: preset.contextWindow,
            maxRequestTokens: preset.maxRequestTokens,
            prefer: preset.prefer,
            label: preset.label,
        });
    }
    globalRouter.__brainEntries = entries;
    globalRouter.__brainRouter = entries.length ? new ModelRouter(entries) : null;
    return globalRouter.__brainRouter ?? undefined;
}
