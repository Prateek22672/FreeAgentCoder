import { describe, expect, it } from 'vitest';
import { explainError, isContextTooLarge, recoveryFor } from './recovery';

const everyFailed = (...lines: string[]) => `Every model failed:\n${lines.map((line) => `  • ${line}`).join('\n')}`;

describe('recoveryFor', () => {
    it('waits out temporary problems, longer the second time', () => {
        const message = everyFailed('groq:openai/gpt-oss-120b (College): groq: Rate limit reached on requests per minute', 'gemini:gemini-3.8-flash (Personal): gemini: 503 overloaded');
        expect(recoveryFor(message, 0)?.delayMs).toBe(30_000);
        expect(recoveryFor(message, 1)?.delayMs).toBe(90_000);
        expect(recoveryFor(message, 2)).toBeUndefined();
    });

    it('says when the connection dropped', () => {
        expect(recoveryFor('fetch failed', 0)?.explanation).toMatch(/connection/);
    });

    it('does not wait on daily limits, which will not reset in a minute', () => {
        const message = everyFailed('groq:m (College): groq: rate limit on tokens per day (TPD)', "gemini:m (Personal): gemini: rate limit GenerateRequestsPerDayPerProjectPerModel");
        expect(recoveryFor(message, 0)).toBeUndefined();
    });

    it('still waits when one key is only rate-limited per minute', () => {
        const message = everyFailed('groq:m (College): groq: rate limit on tokens per day (TPD)', 'cerebras:m (Backup): cerebras: 429 too many requests');
        expect(recoveryFor(message, 0)?.delayMs).toBe(30_000);
    });

    it('never retries rejected keys or an oversized conversation', () => {
        expect(recoveryFor(everyFailed('groq:m (College): groq: invalid API key (401)'), 0)).toBeUndefined();
        expect(recoveryFor('The conversation (~900000 tokens) is larger than any configured model accepts (128000).', 0)).toBeUndefined();
    });
});

describe('explainError', () => {
    it('turns daily limits into a clear next step', () => {
        const explained = explainError(everyFailed('groq:m (College): groq: rate limit on tokens per day (TPD)'));
        expect(explained.title).toBe("Today's free limits on your keys are used up");
        expect(explained.action).toBe('openKeys');
    });

    it('recognizes rejected keys, no connection and busy models', () => {
        expect(explainError(everyFailed('gemini:m (Personal): gemini: API key not valid'))).toMatchObject({ title: 'Your keys were rejected by their providers', action: 'openKeys' });
        expect(explainError(everyFailed('groq:m (College): fetch failed', 'gemini:m (Personal): ETIMEDOUT')).title).toBe("Couldn't reach the AI providers");
        expect(explainError(everyFailed('groq:m (College): 503 overloaded')).title).toBe('Every model is busy or rate-limited');
    });

    it('explains an oversized conversation and a missing key', () => {
        expect(explainError('The conversation is larger than any configured model accepts.').title).toMatch(/too long/);
        expect(explainError('No model is configured').title).toBe('No API key is ready to use');
    });

    it('falls back to plain wording for anything else', () => {
        expect(explainError(everyFailed('groq:m (College): 400 invalid tool schema')).title).toBe('None of your keys could complete this request');
        expect(explainError('Something odd happened').title).toMatch(/unexpected error/);
    });

    it('detects an oversized conversation', () => {
        expect(isContextTooLarge('The conversation (~9 tokens) is larger than any configured model accepts (8).')).toBe(true);
        expect(isContextTooLarge('rate limit')).toBe(false);
    });
});
