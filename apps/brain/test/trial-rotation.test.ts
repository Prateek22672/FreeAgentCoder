import { describe, expect, it, vi } from 'vitest';
import type { PoolTarget } from '../lib/keypool';

vi.mock('server-only', () => ({}));

const { plan } = await import('../lib/trialPlan');
const { restSeconds } = await import('../lib/keypool');

const key = (id: string, provider: string, usedToday = 0, maxRequestTokens?: number): PoolTarget => ({
    id,
    provider,
    label: id,
    baseURL: 'https://x',
    apiKey: 'k',
    contextWindow: 1_000_000,
    maxRequestTokens,
    maxTokensParam: 'max_tokens',
    headers: {},
    thoughtSignatures: false,
    usedToday,
});

describe('free trial rotation', () => {
    it('tries two keys of each provider before more of the same, so eight tired Gemini keys cannot use up every attempt', () => {
        const pool = [
            ...Array.from({ length: 8 }, (_, i) => key(`gem${i}`, 'gemini', i)),
            key('nv1', 'nvidia'),
            ...Array.from({ length: 8 }, (_, i) => key(`groq${i}`, 'groq', i, 8_000)),
            key('or1', 'openrouter'),
        ];
        const order = plan(pool, 'deep', 20_000).map((t) => t.id);
        expect(order.slice(0, 6)).toEqual(['gem0', 'gem1', 'nv1', 'or1', 'gem2', 'gem3']);
        expect(order).not.toContain('groq0');
        expect(plan(pool, 'fast', 3_000).slice(0, 4).map((t) => t.provider)).toEqual(['groq', 'groq', 'gemini', 'gemini']);
    });

    it('rests a key for as long as the provider says, until tomorrow for a daily quota, and a minute otherwise', () => {
        expect(restSeconds('30', '')).toBe(30);
        const now = Date.UTC(2026, 9, 11, 22, 0, 0);
        expect(restSeconds(null, 'You exceeded your current quota, please check your plan', now)).toBe(2 * 3600 + 5 * 60);
        expect(restSeconds(null, 'Rate limit reached for requests per minute')).toBe(60);
        expect(restSeconds('999999', '')).toBe(86_400);
    });
});
