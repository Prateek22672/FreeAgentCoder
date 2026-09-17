import { describe, expect, it } from 'vitest';
import type { KeyView, PromptsLeft, UsageCounts } from '../shared/protocol';
import { capacityMessage, capacityRisk, estimateSavings, isDailyLimit, requestsNeeded, type TaskShape } from './forecast';
import type { TaskStats } from './usageStore';

const none: TaskStats = { tasks: 0, completed: 0, tokens: 0, requests: 0, durationMs: 0, recoveries: 0, deepTasks: 0, deepRequests: 0 };
const shape = (over: Partial<TaskShape> = {}): TaskShape => ({ tier: 'deep', playbooks: 0, attachments: 0, correction: false, test: false, ...over });
const counts = (inputTokens: number, outputTokens: number): UsageCounts => ({ requests: 1, errors: 0, inputTokens, outputTokens });

function key(provider: string, today: UsageCounts, month: UsageCounts): KeyView {
    return {
        id: provider,
        provider,
        providerLabel: provider,
        label: provider,
        last4: '0000',
        source: 'extension',
        enabled: true,
        status: 'active',
        today,
        month,
        window: today,
    };
}

describe('isDailyLimit', () => {
    it('recognizes daily quotas from each provider', () => {
        expect(isDailyLimit("gemini: Quota exceeded for metric 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', limit: 250")).toBe(true);
        expect(isDailyLimit('groq: Rate limit reached for model on tokens per day (TPD): Limit 500000, Used 499000')).toBe(true);
        expect(isDailyLimit('openrouter: Rate limit exceeded: free-models-per-day')).toBe(true);
    });

    it('does not treat per-minute limits as daily', () => {
        expect(isDailyLimit('groq: Rate limit reached on requests per minute (RPM): Limit 30')).toBe(false);
        expect(isDailyLimit('cerebras: 429 Too Many Requests')).toBe(false);
    });
});

describe('requestsNeeded', () => {
    it('uses typical sizes until there is history', () => {
        expect(requestsNeeded(none, shape({ tier: 'fast' }))).toEqual({ expected: 3, fromHistory: false });
        expect(requestsNeeded(none, shape()).expected).toBe(12);
    });

    it('scales for builds, attachments and corrections', () => {
        expect(requestsNeeded(none, shape({ playbooks: 1 })).expected).toBe(18);
        expect(requestsNeeded(none, shape({ test: true })).expected).toBe(18);
        expect(requestsNeeded(none, shape({ attachments: 2 })).expected).toBe(14);
        expect(requestsNeeded(none, shape({ correction: true })).expected).toBe(10);
    });

    it("learns from the user's own complex and quick tasks separately", () => {
        const stats: TaskStats = { ...none, tasks: 10, requests: 130, deepTasks: 5, deepRequests: 110 };
        expect(requestsNeeded(stats, shape())).toEqual({ expected: 22, fromHistory: true });
        expect(requestsNeeded(stats, shape({ tier: 'fast' }))).toEqual({ expected: 4, fromHistory: true });
    });
});

describe('capacityRisk', () => {
    const left = (requestsLeft: number | undefined, atLeast = false): PromptsLeft => ({ requestsLeft, atLeast, requestsPerPrompt: 9, basis: '' });

    it('flags a task that will not fit in the known remaining requests', () => {
        expect(capacityRisk(left(5), 12)).toBe('short');
        expect(capacityRisk(left(20), 12)).toBe('tight');
        expect(capacityRisk(left(30), 12)).toBe('ok');
    });

    it('only warns softly when some keys have limits it cannot see', () => {
        expect(capacityRisk(left(5, true), 12)).toBe('tight');
        expect(capacityRisk(left(20, true), 12)).toBe('ok');
    });

    it('says nothing when no key reports a limit', () => {
        expect(capacityRisk(left(undefined), 12)).toBeUndefined();
    });

    it('explains the shortfall with numbers', () => {
        const message = capacityMessage('short', left(5), 12);
        expect(message.title).toMatch(/run out/);
        expect(message.detail).toContain('about 12 model requests');
        expect(message.detail).toContain('about 5 left today');
    });
});

describe('estimateSavings', () => {
    it('prices free-key usage like a paid model and leaves paid keys out', () => {
        const savings = estimateSavings([key('gemini', counts(100_000, 10_000), counts(1_000_000, 100_000)), key('openai', counts(1_000_000, 0), counts(9_000_000, 0))]);
        expect(savings.usd30d).toBeCloseTo(4.5);
        expect(savings.usdToday).toBeCloseTo(0.45);
        expect(savings.tokens30d).toBe(1_100_000);
        expect(savings.basis).toContain('$3 per million input tokens');
    });
});
