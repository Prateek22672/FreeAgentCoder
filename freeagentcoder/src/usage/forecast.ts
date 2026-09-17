import { compactNumber } from '../shared/format';
import type { KeyView, PromptsLeft, SavingsView, Tier, UsageCounts } from '../shared/protocol';
import type { TaskStats } from './usageStore';

/** Providers with a free tier: usage on these keys is money the user didn't spend. */
export const FREE_PROVIDERS = new Set(['gemini', 'groq', 'cerebras', 'mistral', 'openrouter']);

/** Priced like a typical paid coding model, in US dollars per million tokens. */
export const REFERENCE_RATE = { input: 3, output: 15 };

/** Model requests a task takes before there is history to learn from. */
const TYPICAL_REQUESTS: Record<Tier, number> = { fast: 3, deep: 12 };

const DAILY_LIMIT = /per[\s_-]?day|perday|\bdaily\b|\b[TR]PD\b|free-models-per-day/i;

/** A rate-limit error about a daily quota, which won't come back by waiting a minute. */
export function isDailyLimit(message: string): boolean {
    return DAILY_LIMIT.test(message);
}

export interface TaskShape {
    tier: Tier;
    playbooks: number;
    attachments: number;
    correction: boolean;
    test: boolean;
}

/** How many model requests a task will likely take, from this user's own history when there is enough of it. */
export function requestsNeeded(stats: TaskStats, shape: TaskShape): { expected: number; fromHistory: boolean } {
    const deep = shape.tier === 'deep';
    const tasks = deep ? stats.deepTasks : stats.tasks - stats.deepTasks;
    const requests = deep ? stats.deepRequests : stats.requests - stats.deepRequests;
    const fromHistory = tasks >= 3 && requests > 0;
    let expected = fromHistory ? requests / tasks : TYPICAL_REQUESTS[shape.tier];
    if (shape.playbooks > 0 || shape.test) {
        // Builds and test runs go round a check-and-fix loop.
        expected *= 1.5;
    }
    if (shape.attachments > 0) {
        expected += 2;
    }
    if (shape.correction) {
        expected *= 0.8;
    }
    return { expected: Math.max(1, Math.round(expected)), fromHistory };
}

export type CapacityRisk = 'ok' | 'tight' | 'short';

/**
 * Whether today's known limits may run out before a task finishes. Undefined
 * when no key reports a limit. Keys without a known limit add capacity that
 * can't be seen, so with those present only a clear shortfall is flagged.
 */
export function capacityRisk(left: PromptsLeft, needed: number): CapacityRisk | undefined {
    if (left.requestsLeft === undefined) {
        return undefined;
    }
    if (left.atLeast) {
        return left.requestsLeft < needed ? 'tight' : 'ok';
    }
    if (left.requestsLeft < needed) {
        return 'short';
    }
    return left.requestsLeft < needed * 2 ? 'tight' : 'ok';
}

export function capacityMessage(risk: Exclude<CapacityRisk, 'ok'>, left: PromptsLeft, needed: number): { title: string; detail: string } {
    const remaining = left.requestsLeft ?? 0;
    if (risk === 'short') {
        return {
            title: 'Your keys may run out before this task finishes',
            detail: `This task will likely need about ${needed} model requests, and your keys have about ${remaining} left today. Add a key from another provider now so the task doesn't stop halfway.`,
        };
    }
    return {
        title: "Today's limits are getting low",
        detail: `This task will likely need about ${needed} model requests, and about ${remaining} are left today${
            left.atLeast ? ' on keys that report a limit (your other keys add more)' : ''
        }. If they run out, the task pauses until a key is free again or you add one.`,
    };
}

function cost(counts: UsageCounts): number {
    return (counts.inputTokens * REFERENCE_RATE.input + counts.outputTokens * REFERENCE_RATE.output) / 1_000_000;
}

/** What the usage on free keys would have cost on a paid model. Paid keys are left out: that money was spent. */
export function estimateSavings(keys: KeyView[]): SavingsView {
    const free = keys.filter((k) => FREE_PROVIDERS.has(k.provider));
    const tokens30d = free.reduce((n, k) => n + k.month.inputTokens + k.month.outputTokens, 0);
    return {
        usdToday: free.reduce((n, k) => n + cost(k.today), 0),
        usd30d: free.reduce((n, k) => n + cost(k.month), 0),
        tokens30d,
        basis: `What the ${compactNumber(tokens30d)} tokens your free keys used in the last 30 days would cost on a typical paid coding model ($${REFERENCE_RATE.input} per million input tokens, $${REFERENCE_RATE.output} per million output). An estimate: real prices vary by model.`,
    };
}
