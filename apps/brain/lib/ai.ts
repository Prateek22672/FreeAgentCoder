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

/** Large-context providers first: answers are built from many excerpts. */
const ORDER = ['gemini', 'mistral', 'openrouter', 'cerebras', 'groq'];

const globalRouter = globalThis as unknown as { __brainRouter?: ModelRouter | null };

function customEntry(): RouterEntry | undefined {
    const baseURL = process.env.BRAIN_OPENAI_BASE_URL?.trim();
    const model = process.env.BRAIN_OPENAI_MODEL?.trim();
    if (!baseURL || !model) return undefined;
    const contextWindow = Number(process.env.BRAIN_OPENAI_CONTEXT) || 32_768;
    return {
        provider: new OpenAICompatProvider({ id: 'custom', baseURL, apiKey: process.env.BRAIN_OPENAI_API_KEY || undefined, maxOutputTokens: 4_096 }),
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
export const OWN_KEY_PROVIDERS = ['gemini', 'groq', 'cerebras', 'openrouter', 'mistral'] as const;
export type OwnKeyProvider = (typeof OWN_KEY_PROVIDERS)[number];

/**
 * A one-off chain for a visitor's own key, sent with the request. The key is
 * used for this request only: never stored, cached or logged.
 */
export function routerForKey(provider: string, key: string): ModelRouter | undefined {
    if (!(OWN_KEY_PROVIDERS as readonly string[]).includes(provider)) return undefined;
    if (!/^[\x21-\x7e]{16,256}$/.test(key)) return undefined;
    const preset = PRESETS[provider];
    if (!preset) return undefined;
    return new ModelRouter([
        {
            provider: createProvider(preset, { apiKey: key, maxOutputTokens: 4_096 }),
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
            provider: createProvider(preset, { apiKey: key, maxOutputTokens: 4_096 }),
            model: preset.defaultModel,
            contextWindow: preset.contextWindow,
            maxRequestTokens: preset.maxRequestTokens,
            prefer: preset.prefer,
            label: preset.label,
        });
    }
    globalRouter.__brainRouter = entries.length ? new ModelRouter(entries) : null;
    return globalRouter.__brainRouter ?? undefined;
}
