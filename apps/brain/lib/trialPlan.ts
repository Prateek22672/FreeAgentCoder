import type { PoolTarget } from './keypool';

/** The model each provider runs for a fast or a deep step. */
export const MODELS: Record<string, { fast: string; deep: string }> = {
    gemini: { fast: 'gemini-3.5-flash-lite', deep: 'gemini-3.8-flash' },
    groq: { fast: 'openai/gpt-oss-120b', deep: 'openai/gpt-oss-120b' },
    nvidia: { fast: 'nvidia/nemotron-3-super-120b-a12b', deep: 'nvidia/nemotron-3-ultra-550b-a55b' },
    mistral: { fast: 'mistral-small-latest', deep: 'mistral-medium-latest' },
    cerebras: { fast: 'gpt-oss-120b', deep: 'gpt-oss-120b' },
    openrouter: { fast: 'openrouter/free', deep: 'openrouter/free' },
    openai: { fast: 'gpt-5-mini', deep: 'gpt-5' },
};
export const ORDER = {
    fast: ['groq', 'gemini', 'cerebras', 'nvidia', 'openrouter', 'mistral', 'custom', 'openai'],
    deep: ['gemini', 'nvidia', 'cerebras', 'mistral', 'groq', 'openrouter', 'custom', 'openai'],
};

/** The model a key runs for this tier: a custom provider's own, otherwise the table above. */
export function modelFor(target: PoolTarget, tier: 'fast' | 'deep'): string | undefined {
    return target.models?.[tier] ?? MODELS[target.provider]?.[tier];
}
/** Keys tried per provider before moving on: keys of one provider often share a limit, so a third rarely helps. */
const PER_PROVIDER = 2;

/**
 * Keys in the order to try, for a request this size: two of each provider in
 * the tier's order (least used first), then the rest. A request never spends
 * all its attempts on one provider that is out of requests. Keys marked "use
 * first" (a generous allowance worth using up) lead, in the same way.
 */
export function plan(targets: PoolTarget[], tier: 'fast' | 'deep', size: number): PoolTarget[] {
    const fits = targets.filter((t) => modelFor(t, tier) && size <= Math.min(t.maxRequestTokens ?? Infinity, t.contextWindow * 0.9));
    // Each custom provider is its own group: two keys of one service share its limit, two services do not.
    const group = (t: PoolTarget) => (t.provider === 'custom' ? `custom:${t.baseURL}` : t.provider);
    const rank = (t: PoolTarget) => {
        const at = ORDER[tier].indexOf(t.provider);
        return (t.first ? -100 : 0) + (at < 0 ? ORDER[tier].length : at);
    };
    const groups = new Map<string, PoolTarget[]>();
    for (const t of [...fits].sort((a, b) => rank(a) - rank(b) || a.usedToday - b.usedToday)) {
        const key = `${t.first ? 'first:' : ''}${group(t)}`;
        groups.set(key, [...(groups.get(key) ?? []), t]);
    }
    const byProvider = [...groups.values()];
    return [...byProvider.flatMap((keys) => keys.slice(0, PER_PROVIDER)), ...byProvider.flatMap((keys) => keys.slice(PER_PROVIDER))];
}

