import { describe, expect, it } from 'vitest';
import { planRoute } from './catalog';

const keys = ['gemini', 'groq', 'cohere', 'openrouter'].map((provider) => ({ id: provider, provider, label: provider }));
const route = (tier: 'fast' | 'deep') => planRoute(keys, 'auto', tier, () => 0).steps.map((s) => `${s.provider}:${s.model}`);

describe('planRoute', () => {
    it('tries every Gemini model on the key before another provider, and the free router last', () => {
        const deep = route('deep');
        expect(deep.slice(0, 5)).toEqual(['gemini:gemini-3.8-flash', 'gemini:gemini-3.7-flash', 'gemini:gemini-3.6-flash', 'gemini:gemini-3.5-flash', 'gemini:gemini-2.5-flash']);
        expect(deep.indexOf('groq:openai/gpt-oss-120b')).toBeLessThan(deep.indexOf('cohere:command-a-plus-05-2026'));
        expect(deep.at(-1)).toBe('openrouter:openrouter/free');
    });

    it('starts quick tasks on Groq with a backup model on the same key', () => {
        expect(route('fast').slice(0, 2)).toEqual(['groq:openai/gpt-oss-120b', 'groq:qwen/qwen3.8-27b']);
    });
});
