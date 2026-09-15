import { compactNumber, formatDuration } from '../shared/format';
import type { CapacityWindow, KeyView, PromptsLeft, ProviderCapacity, Suggestion } from '../shared/protocol';
import { addCounts, emptyCounts } from './usageStore';

const FRESH_MS = 24 * 3_600_000;
/** Model requests a typical prompt takes (reading, editing, checking) before there's history to learn from. */
export const TYPICAL_REQUESTS_PER_PROMPT = 8;

function windowName(dimension: string, period?: string): string {
    return `${dimension.charAt(0).toUpperCase()}${dimension.slice(1)}${period ? ` per ${period}` : ''}`;
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Limits each provider reports, added up across all of its usable keys. */
export function providerCapacity(keys: KeyView[], rateLimitsToday: Record<string, number>, now: number): ProviderCapacity[] {
    const byProvider = new Map<string, KeyView[]>();
    for (const key of keys) {
        byProvider.set(key.provider, [...(byProvider.get(key.provider) ?? []), key]);
    }

    const result: ProviderCapacity[] = [];
    for (const [provider, list] of byProvider) {
        const usable = list.filter((k) => k.enabled && k.status !== 'invalid');
        const windows = new Map<string, CapacityWindow>();
        for (const key of usable) {
            if (!key.quota || now - key.quota.capturedAt > FRESH_MS) {
                continue;
            }
            for (const w of key.quota.windows) {
                const id = `${w.dimension}|${w.period ?? ''}`;
                const hasReset = !!w.resetAt && w.resetAt <= now;
                const current = windows.get(id) ?? { name: windowName(w.dimension, w.period), dimension: w.dimension, period: w.period, used: 0, limit: 0, reportingKeys: 0 };
                current.used += hasReset ? 0 : w.limit - w.remaining;
                current.limit += w.limit;
                current.reportingKeys++;
                if (!hasReset && w.resetAt) {
                    current.resetAt = Math.min(current.resetAt ?? Infinity, w.resetAt);
                }
                windows.set(id, current);
            }
        }
        result.push({
            provider,
            label: list[0]?.providerLabel ?? provider,
            keys: list.length,
            usableKeys: usable.length,
            today: list.reduce((total, k) => addCounts(total, k.today), emptyCounts()),
            rateLimitsToday: list.reduce((n, k) => n + (rateLimitsToday[k.id] ?? 0), 0),
            windows: [...windows.values()],
        });
    }
    return result.sort((a, b) => b.today.inputTokens + b.today.outputTokens - (a.today.inputTokens + a.today.outputTokens));
}

/** Requests left today on a key, from its reported daily window. Groq's unsuffixed request headers are per day. */
function reportedDailyRequests(key: KeyView, now: number): number | undefined {
    if (!key.quota || now - key.quota.capturedAt > FRESH_MS) {
        return undefined;
    }
    const w = key.quota.windows.find((win) => win.dimension === 'requests' && (win.period === 'day' || (!win.period && key.provider === 'groq')));
    if (!w) {
        return undefined;
    }
    return w.resetAt && w.resetAt <= now ? w.limit : Math.max(0, w.remaining);
}

/**
 * How many more prompts today's limits allow: daily requests left on every
 * key that has a known limit (reported in headers, or named by the provider
 * in a rate-limit error), divided by how many requests a prompt takes.
 */
export function estimatePromptsLeft(input: { keys: KeyView[]; learnedLimits: Record<string, number>; recent: { tasks: number; requests: number }; now: number }): PromptsLeft {
    const usable = input.keys.filter((k) => k.enabled && k.status !== 'invalid');
    const learnedFromHistory = input.recent.tasks >= 3 && input.recent.requests > 0;
    const perPrompt = learnedFromHistory ? Math.max(1, input.recent.requests / input.recent.tasks) : TYPICAL_REQUESTS_PER_PROMPT;
    const rounded = Math.max(1, Math.round(perPrompt));
    const rate = learnedFromHistory
        ? `about ${rounded} model requests per prompt (your average over the last 7 days)`
        : `about ${rounded} model requests per prompt (a typical figure; it becomes yours after a few tasks)`;

    if (!usable.length) {
        return { value: 0, atLeast: false, requestsPerPrompt: rounded, basis: 'No active keys.' };
    }
    let remaining = 0;
    let known = 0;
    let learnedGemini = false;
    for (const key of usable) {
        const reported = reportedDailyRequests(key, input.now);
        if (reported !== undefined) {
            remaining += reported;
            known++;
        } else if (input.learnedLimits[key.id]) {
            remaining += Math.max(0, input.learnedLimits[key.id] - key.today.requests);
            known++;
            learnedGemini ||= key.provider === 'gemini';
        }
    }
    if (!known) {
        return {
            atLeast: true,
            requestsPerPrompt: rounded,
            basis: "None of your active keys has reported a daily request limit yet, so prompts left can't be estimated. Gemini names its limit the first time you reach it; Groq, Cerebras and OpenRouter report theirs with every response.",
        };
    }
    const partial = known < usable.length;
    return {
        value: Math.floor(remaining / perPrompt),
        atLeast: partial,
        requestsPerPrompt: rounded,
        basis: `${remaining.toLocaleString('en-US')} requests left today across ${known} of ${plural(usable.length, 'active key')} with a known daily limit, at ${rate}.${
            partial ? ' Keys without a known limit add more on top.' : ''
        }${learnedGemini ? ' Gemini limits are shared by keys from the same Google Cloud project.' : ''}`,
    };
}

export interface AdvisorInput {
    keys: KeyView[];
    capacity: ProviderCapacity[];
    weakFallbacksToday: number;
    recent: { tasks: number; tokens: number; requests: number };
    promptsLeft?: PromptsLeft;
    now: number;
}

/**
 * Plain-language advice on how many keys are enough, from what actually
 * happened: rate limits hit, limits nearly used up, fallbacks to weak models,
 * prompts left today and how big the user's tasks are.
 */
export function adviseKeys(input: AdvisorInput): Suggestion[] {
    const { capacity, now } = input;
    const usable = input.keys.filter((k) => k.enabled && k.status !== 'invalid');
    if (!usable.length) {
        return [];
    }
    const providers = new Set(usable.map((k) => k.provider));
    const out: Suggestion[] = [];

    const left = input.promptsLeft;
    if (left?.value !== undefined && !left.atLeast && left.value < 15) {
        out.push({
            id: 'low-prompts',
            level: 'warn',
            title: left.value === 0 ? "Today's limits are used up" : `Only about ${plural(left.value, 'prompt')} left today`,
            detail: `${left.basis} ${providers.has('gemini') ? 'Another key' : 'A free Gemini key'} lets you keep working today.`,
            action: 'addKey',
            provider: providers.has('gemini') ? 'groq' : 'gemini',
        });
    }

    if (usable.length === 1) {
        out.push({
            id: 'second-key',
            level: 'warn',
            title: 'Add a second key',
            detail: 'With a single key, one rate limit pauses your work. Two or three keys, ideally from different providers, keep long tasks running.',
            action: 'addKey',
            provider: providers.has('gemini') ? 'groq' : 'gemini',
        });
    } else if (providers.size === 1) {
        const only = capacity.find((c) => c.usableKeys > 0)?.label ?? 'one provider';
        const next = providers.has('gemini') ? 'groq' : 'gemini';
        out.push({
            id: 'second-provider',
            level: 'tip',
            title: 'Add a different provider',
            detail: `All your keys are ${only}. If it has an outage or you reach its daily limit, everything stops. ${
                next === 'gemini' ? "Gemini's free tier handles large projects best." : 'Groq is very fast for quick questions and small edits.'
            }`,
            action: 'addKey',
            provider: next,
        });
    }

    for (const c of capacity) {
        if (!c.usableKeys) {
            continue;
        }
        if (c.rateLimitsToday >= 3) {
            const extra = Math.min(3, Math.max(1, Math.ceil(c.rateLimitsToday / 8)));
            out.push({
                id: `limits-${c.provider}`,
                level: 'warn',
                title: `${c.label} hit its limit ${c.rateLimitsToday} times today`,
                detail: `Adding ${plural(extra, 'more key')} would spread the load across your ${plural(c.usableKeys, `${c.label} key`)} and cut the waiting.`,
                action: 'addKey',
                provider: c.provider,
            });
        }
        const tight = c.windows.filter((w) => w.limit > 0 && w.used / w.limit >= 0.8).sort((a, b) => b.used / b.limit - a.used / a.limit)[0];
        if (tight) {
            out.push({
                id: `quota-${c.provider}`,
                level: 'warn',
                title: `${c.label}: ${Math.round((tight.used / tight.limit) * 100)}% of ${tight.name.toLowerCase()} used`,
                detail: `${compactNumber(tight.used)} of ${compactNumber(tight.limit)} across ${plural(tight.reportingKeys, 'key')}${
                    tight.resetAt ? `, resets in ${formatDuration(tight.resetAt - now)}` : ''
                }. Add a key, or your other providers will take over until it resets.`,
                action: 'addKey',
                provider: c.provider,
            });
        }
    }

    if (input.weakFallbacksToday >= 3) {
        out.push({
            id: 'weak-fallback',
            level: 'warn',
            title: 'Complex tasks fell back to a weak model',
            detail: `OpenRouter's free router handled ${input.weakFallbacksToday} requests for complex tasks today because your stronger keys were busy or failing. ${
                providers.has('gemini') ? 'Another Gemini or Mistral key' : 'A free Gemini key'
            } would give much better results on large builds.`,
            action: 'addKey',
            provider: providers.has('gemini') ? 'mistral' : 'gemini',
        });
    }

    const { tasks, tokens, requests } = input.recent;
    if (tasks >= 3) {
        const requestsPerTask = requests / tasks;
        const tokensPerTask = tokens / tasks;
        if (!providers.has('gemini') && tokensPerTask > 30_000 && !out.some((s) => s.provider === 'gemini')) {
            out.push({
                id: 'large-tasks',
                level: 'tip',
                title: 'Your tasks are large: add Gemini',
                detail: `Your tasks average about ${compactNumber(tokensPerTask)} tokens. Gemini's free tier accepts far bigger requests than Groq or Cerebras.`,
                action: 'addKey',
                provider: 'gemini',
            });
        }
        if (left?.value === undefined) {
            out.push({
                id: 'sizing',
                level: 'tip',
                title: 'How many keys you need',
                detail: `Your tasks use about ${Math.round(requestsPerTask)} requests and ${compactNumber(tokensPerTask)} tokens each. For steady daily work, 2–3 keys each from 2 providers usually avoids waiting on rate limits.`,
            });
        }
    }
    return out;
}
