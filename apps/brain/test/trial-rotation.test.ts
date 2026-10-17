import { describe, expect, it, vi } from 'vitest';
import type { PoolTarget } from '../lib/keypool';

vi.mock('server-only', () => ({}));

const { modelFor, plan } = await import('../lib/trialPlan');
const { publicBaseURL } = await import('../lib/keyhealth');
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

    it('puts a provider marked "use first" ahead of every built-in one, with its own models, and Cerebras in line', () => {
        const bonus = { ...key('bonus', 'custom'), baseURL: 'https://api.bonus.example/v1', models: { fast: 'qwen3-coder', deep: 'kimi-k3' }, first: true };
        const later = { ...key('later', 'custom'), baseURL: 'https://api.other.example/v1', models: { fast: 'm-small', deep: 'm-large' } };
        const pool = [key('gem0', 'gemini'), key('groq0', 'groq'), key('cb0', 'cerebras'), bonus, later];
        expect(plan(pool, 'deep', 2_000).map((t) => t.id)).toEqual(['bonus', 'gem0', 'cb0', 'groq0', 'later']);
        expect(plan(pool, 'fast', 2_000).map((t) => t.id)).toEqual(['bonus', 'groq0', 'gem0', 'cb0', 'later']);
        expect(modelFor(bonus, 'deep')).toBe('kimi-k3');
        expect(modelFor(key('cb1', 'cerebras'), 'fast')).toBe('gpt-oss-120b');
        // A custom key with no models of its own is never tried.
        expect(plan([key('bare', 'custom')], 'deep', 100)).toEqual([]);
    });

    it('takes only a public https address for a custom provider', () => {
        expect(publicBaseURL('https://api.example.com/v1/')).toBe('https://api.example.com/v1');
        expect(publicBaseURL('http://api.example.com/v1')).toBeUndefined();
        expect(publicBaseURL('https://localhost:8080/v1')).toBeUndefined();
        expect(publicBaseURL('https://127.0.0.1/v1')).toBeUndefined();
        expect(publicBaseURL('https://192.168.1.4/v1')).toBeUndefined();
        expect(publicBaseURL('https://172.20.0.1/v1')).toBeUndefined();
        expect(publicBaseURL('https://[::1]/v1')).toBeUndefined();
        expect(publicBaseURL('https://metadata.internal/v1')).toBeUndefined();
        expect(publicBaseURL('not a url')).toBeUndefined();
    });
});
