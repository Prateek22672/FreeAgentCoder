import * as vscode from 'vscode';
import type { QuotaSnapshot, QuotaWindow, UsageCounts, UsageDay } from '../shared/protocol';

interface DayEvents {
    rateLimits: Record<string, number>;
    weakFallbacks: number;
    tasks: number;
    completed: number;
    taskTokens: number;
    taskRequests: number;
    taskDurationMs: number;
    recoveries: number;
    deepTasks?: number;
    deepRequests?: number;
}

/** How one key is doing with one model since VS Code started. */
export interface CallHealth {
    calls: number;
    failures: number;
    latencyTotalMs: number;
    consecutiveFailures: number;
    lastOkAt?: number;
    lastError?: string;
    lastErrorAt?: number;
}

interface LearnedLimit {
    requestsPerDay: number;
    learnedAt: number;
}

interface Persisted {
    days: Record<string, Record<string, UsageCounts>>;
    lastUsed: Record<string, number>;
    quota: Record<string, QuotaSnapshot>;
    events: Record<string, DayEvents>;
    limits: Record<string, LearnedLimit>;
}

export interface TaskStats {
    tasks: number;
    completed: number;
    tokens: number;
    requests: number;
    durationMs: number;
    recoveries: number;
    /** Complex tasks and their model requests, to size the next complex task. */
    deepTasks: number;
    deepRequests: number;
}

const STORAGE_KEY = 'freeagentcoder.usage.v1';
const KEEP_DAYS = 30;
const QUOTA_STALE_MS = 10 * 60_000;

export function emptyCounts(): UsageCounts {
    return { requests: 0, errors: 0, inputTokens: 0, outputTokens: 0 };
}

export function addCounts(a: UsageCounts, b: UsageCounts): UsageCounts {
    return {
        requests: a.requests + b.requests,
        errors: a.errors + b.errors,
        inputTokens: a.inputTokens + b.inputTokens,
        outputTokens: a.outputTokens + b.outputTokens,
    };
}

export function dayKey(time = Date.now()): string {
    const d = new Date(time);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function emptyEvents(): DayEvents {
    return { rateLimits: {}, weakFallbacks: 0, tasks: 0, completed: 0, taskTokens: 0, taskRequests: 0, taskDurationMs: 0, recoveries: 0, deepTasks: 0, deepRequests: 0 };
}

/**
 * Usage counted locally from provider responses, per key and per day, kept
 * for 30 days, plus the events the key advisor learns from (rate limits,
 * fallbacks to weak models, task sizes and outcomes) and daily limits learned
 * from providers' rate-limit errors. Live key state that shouldn't outlive
 * the window (cooldowns, auth failures of external keys, last errors) is kept
 * in memory only.
 */
export class UsageStore implements vscode.Disposable {
    private readonly data: Persisted;
    private readonly windowUsage = new Map<string, UsageCounts>();
    private readonly cooldowns = new Map<string, number>();
    private readonly invalid = new Map<string, string>();
    private readonly lastErrors = new Map<string, { message: string; at: number }>();
    private readonly health = new Map<string, CallHealth>();
    /** Keys that hit a daily limit, until it resets: waiting a minute won't bring them back. */
    private readonly exhausted = new Map<string, number>();
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChange = this.changed.event;
    private saveTimer?: ReturnType<typeof setTimeout>;
    private notifyTimer?: ReturnType<typeof setTimeout>;

    constructor(private readonly context: vscode.ExtensionContext) {
        const raw = context.globalState.get<Partial<Persisted>>(STORAGE_KEY);
        this.data = { days: raw?.days ?? {}, lastUsed: raw?.lastUsed ?? {}, quota: raw?.quota ?? {}, events: raw?.events ?? {}, limits: raw?.limits ?? {} };
        this.prune();
    }

    record(keyId: string, call: { ok: boolean; inputTokens: number; outputTokens: number }): void {
        const delta: UsageCounts = { requests: 1, errors: call.ok ? 0 : 1, inputTokens: call.inputTokens, outputTokens: call.outputTokens };
        const today = (this.data.days[dayKey()] ??= {});
        today[keyId] = addCounts(today[keyId] ?? emptyCounts(), delta);
        this.windowUsage.set(keyId, addCounts(this.windowUsage.get(keyId) ?? emptyCounts(), delta));
        this.data.lastUsed[keyId] = Date.now();
        if (call.ok) {
            this.cooldowns.delete(keyId);
            this.exhausted.delete(keyId);
        }
        this.touch();
    }

    /** Outcome and speed of one call, for the Health view. */
    recordCall(keyId: string, model: string, call: { ok: boolean; latencyMs: number; error?: string }): void {
        const id = `${keyId}|${model}`;
        const entry = this.health.get(id) ?? { calls: 0, failures: 0, latencyTotalMs: 0, consecutiveFailures: 0 };
        entry.calls++;
        if (call.ok) {
            entry.latencyTotalMs += Math.max(0, call.latencyMs);
            entry.consecutiveFailures = 0;
            entry.lastOkAt = Date.now();
        } else {
            entry.failures++;
            entry.consecutiveFailures++;
            entry.lastError = call.error;
            entry.lastErrorAt = Date.now();
        }
        this.health.set(id, entry);
        this.touch();
    }

    callHealth(keyId: string, model: string): CallHealth | undefined {
        return this.health.get(`${keyId}|${model}`);
    }

    markExhausted(keyId: string, until: number): void {
        this.exhausted.set(keyId, until);
        this.cooldowns.set(keyId, until);
        this.touch();
    }

    exhaustedUntil(keyId: string): number | undefined {
        const until = this.exhausted.get(keyId);
        return until && until > Date.now() ? until : undefined;
    }

    recordQuota(keyId: string, windows: QuotaWindow[]): void {
        const previous = this.data.quota[keyId];
        if (!windows.length && previous?.windows.length && Date.now() - previous.capturedAt < QUOTA_STALE_MS) {
            return;
        }
        this.data.quota[keyId] = { capturedAt: Date.now(), windows };
        this.touch();
    }

    recordRateLimit(keyId: string): void {
        const events = this.todayEvents();
        events.rateLimits[keyId] = (events.rateLimits[keyId] ?? 0) + 1;
        this.touch();
    }

    recordWeakFallback(): void {
        this.todayEvents().weakFallbacks++;
        this.touch();
    }

    recordRecovery(): void {
        this.todayEvents().recoveries++;
        this.touch();
    }

    recordTask(task: { tokens: number; requests: number; completed: boolean; durationMs: number; tier: 'fast' | 'deep' }): void {
        const events = this.todayEvents();
        events.tasks++;
        if (task.tier === 'deep') {
            events.deepTasks = (events.deepTasks ?? 0) + 1;
            events.deepRequests = (events.deepRequests ?? 0) + Math.max(0, task.requests);
        }
        events.completed = (events.completed ?? 0) + (task.completed ? 1 : 0);
        events.taskTokens += Math.max(0, task.tokens);
        events.taskRequests += Math.max(0, task.requests);
        events.taskDurationMs = (events.taskDurationMs ?? 0) + Math.max(0, task.durationMs);
        this.touch();
    }

    /** A daily request limit a provider named in a rate-limit error (Gemini does, but sends no quota headers). */
    learnDailyLimit(keyId: string, requestsPerDay: number): void {
        if (!Number.isFinite(requestsPerDay) || requestsPerDay <= 0 || this.data.limits[keyId]?.requestsPerDay === requestsPerDay) {
            return;
        }
        this.data.limits[keyId] = { requestsPerDay, learnedAt: Date.now() };
        this.touch();
    }

    learnedDailyLimits(): Record<string, number> {
        const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
        return Object.fromEntries(Object.entries(this.data.limits).filter(([, l]) => l.learnedAt >= cutoff).map(([id, l]) => [id, l.requestsPerDay]));
    }

    rateLimitsToday(): Record<string, number> {
        return { ...(this.data.events[dayKey()]?.rateLimits ?? {}) };
    }

    weakFallbacksToday(): number {
        return this.data.events[dayKey()]?.weakFallbacks ?? 0;
    }

    /** Tasks finished over the last `days` days: how many, how many completed, and their totals. */
    taskStats(days: number): TaskStats {
        const result: TaskStats = { tasks: 0, completed: 0, tokens: 0, requests: 0, durationMs: 0, recoveries: 0, deepTasks: 0, deepRequests: 0 };
        for (let i = 0; i < days; i++) {
            const events = this.data.events[dayKey(Date.now() - i * 86_400_000)];
            if (events) {
                result.tasks += events.tasks ?? 0;
                result.completed += events.completed ?? 0;
                result.tokens += events.taskTokens ?? 0;
                result.requests += events.taskRequests ?? 0;
                result.durationMs += events.taskDurationMs ?? 0;
                result.recoveries += events.recoveries ?? 0;
                result.deepTasks += events.deepTasks ?? 0;
                result.deepRequests += events.deepRequests ?? 0;
            }
        }
        return result;
    }

    setCooldown(keyId: string, until: number): void {
        this.cooldowns.set(keyId, until);
        this.touch();
    }

    cooldownUntil(keyId: string): number | undefined {
        const until = this.cooldowns.get(keyId);
        return until && until > Date.now() ? until : undefined;
    }

    setInvalid(keyId: string, reason: string | undefined): void {
        if (reason) {
            this.invalid.set(keyId, reason);
        } else {
            this.invalid.delete(keyId);
        }
        this.touch();
    }

    invalidReason(keyId: string): string | undefined {
        return this.invalid.get(keyId);
    }

    setLastError(keyId: string, message: string): void {
        this.lastErrors.set(keyId, { message, at: Date.now() });
        this.touch();
    }

    lastError(keyId: string): { message: string; at: number } | undefined {
        return this.lastErrors.get(keyId);
    }

    quota(keyId: string): QuotaSnapshot | undefined {
        return this.data.quota[keyId];
    }

    lastUsed(keyId: string): number | undefined {
        return this.data.lastUsed[keyId];
    }

    today(keyId?: string): UsageCounts {
        return sum(this.data.days[dayKey()] ?? {}, keyId);
    }

    month(keyId?: string): UsageCounts {
        return Object.values(this.data.days).reduce((total, day) => addCounts(total, sum(day, keyId)), emptyCounts());
    }

    window(keyId?: string): UsageCounts {
        if (keyId) {
            return this.windowUsage.get(keyId) ?? emptyCounts();
        }
        return [...this.windowUsage.values()].reduce(addCounts, emptyCounts());
    }

    days(count: number): UsageDay[] {
        const result: UsageDay[] = [];
        for (let i = count - 1; i >= 0; i--) {
            const time = Date.now() - i * 86_400_000;
            const counts = sum(this.data.days[dayKey(time)] ?? {});
            result.push({ day: dayKey(time), tokens: counts.inputTokens + counts.outputTokens, requests: counts.requests });
        }
        return result;
    }

    forget(keyId: string): void {
        for (const day of Object.values(this.data.days)) {
            delete day[keyId];
        }
        for (const events of Object.values(this.data.events)) {
            delete events.rateLimits[keyId];
        }
        delete this.data.lastUsed[keyId];
        delete this.data.quota[keyId];
        delete this.data.limits[keyId];
        this.windowUsage.delete(keyId);
        this.cooldowns.delete(keyId);
        this.invalid.delete(keyId);
        this.lastErrors.delete(keyId);
        this.exhausted.delete(keyId);
        for (const id of [...this.health.keys()]) {
            if (id.startsWith(`${keyId}|`)) {
                this.health.delete(id);
            }
        }
        this.touch();
    }

    dispose(): void {
        clearTimeout(this.saveTimer);
        clearTimeout(this.notifyTimer);
        void this.context.globalState.update(STORAGE_KEY, this.data);
        this.changed.dispose();
    }

    private todayEvents(): DayEvents {
        const key = dayKey();
        const events = (this.data.events[key] ??= emptyEvents());
        events.rateLimits ??= {};
        return events;
    }

    private touch(): void {
        if (!this.saveTimer) {
            this.saveTimer = setTimeout(() => {
                this.saveTimer = undefined;
                void this.context.globalState.update(STORAGE_KEY, this.data);
            }, 1_500);
        }
        if (!this.notifyTimer) {
            this.notifyTimer = setTimeout(() => {
                this.notifyTimer = undefined;
                this.changed.fire();
            }, 300);
        }
    }

    private prune(): void {
        const cutoff = dayKey(Date.now() - KEEP_DAYS * 86_400_000);
        for (const table of [this.data.days, this.data.events]) {
            for (const day of Object.keys(table)) {
                if (day < cutoff) {
                    delete table[day];
                }
            }
        }
    }
}

function sum(day: Record<string, UsageCounts>, keyId?: string): UsageCounts {
    if (keyId) {
        return day[keyId] ?? emptyCounts();
    }
    return Object.values(day).reduce(addCounts, emptyCounts());
}
