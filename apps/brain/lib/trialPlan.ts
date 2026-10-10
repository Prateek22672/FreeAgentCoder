import type { PoolTarget } from './keypool';

/** The model each provider runs for a fast or a deep step. */
export const MODELS: Record<string, { fast: string; deep: string }> = {
    gemini: { fast: 'gemini-3.5-flash-lite', deep: 'gemini-3.8-flash' },
    groq: { fast: 'openai/gpt-oss-120b', deep: 'openai/gpt-oss-120b' },
    nvidia: { fast: 'nvidia/nemotron-3-super-120b-a12b', deep: 'nvidia/nemotron-3-ultra-550b-a55b' },
    mistral: { fast: 'mistral-small-latest', deep: 'mistral-medium-latest' },
    openrouter: { fast: 'openrouter/free', deep: 'openrouter/free' },
    openai: { fast: 'gpt-5-mini', deep: 'gpt-5' },
};
export const ORDER = {
    fast: ['groq', 'gemini', 'nvidia', 'openrouter', 'mistral', 'openai'],
    deep: ['gemini', 'nvidia', 'mistral', 'groq', 'openrouter', 'openai'],
};
/** Keys tried per provider before moving on: keys of one provider often share a limit, so a third rarely helps. */
const PER_PROVIDER = 2;

/**
 * Keys in the order to try, for a request this size: two of each provider in
 * the tier's order (least used first), then the rest. A request never spends
 * all its attempts on one provider that is out of requests.
 */
export function plan(targets: PoolTarget[], tier: 'fast' | 'deep', size: number): PoolTarget[] {
    const byProvider = ORDER[tier].map((provider) =>
        targets
            .filter((t) => t.provider === provider && MODELS[provider] && size <= Math.min(t.maxRequestTokens ?? Infinity, t.contextWindow * 0.9))
            .sort((a, b) => a.usedToday - b.usedToday),
    );
    return [...byProvider.flatMap((keys) => keys.slice(0, PER_PROVIDER)), ...byProvider.flatMap((keys) => keys.slice(PER_PROVIDER))];
}

