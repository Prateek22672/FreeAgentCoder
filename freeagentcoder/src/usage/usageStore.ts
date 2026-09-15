import * as vscode from 'vscode';
import type { QuotaSnapshot, QuotaWindow, UsageCounts, UsageDay } from '../shared/protocol';

interface Persisted {
    days: Record<string, Record<string, UsageCounts>>;
    lastUsed: Record<string, number>;
    quota: Record<string, QuotaSnapshot>;
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

/**
 * Usage counted locally from provider responses, per key and per day, kept
 * for 30 days. Also holds live key state that shouldn't outlive the window:
 * rate-limit cooldowns and auth failures of keys managed outside the extension.
 */
export class UsageStore implements vscode.Disposable {
    private readonly data: Persisted;
    private readonly windowUsage = new Map<string, UsageCounts>();
    private readonly cooldowns = new Map<string, number>();
    private readonly invalid = new Map<string, string>();
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChange = this.changed.event;
    private saveTimer?: ReturnType<typeof setTimeout>;
    private notifyTimer?: ReturnType<typeof setTimeout>;

    constructor(private readonly context: vscode.ExtensionContext) {
        const raw = context.globalState.get<Partial<Persisted>>(STORAGE_KEY);
        this.data = { days: raw?.days ?? {}, lastUsed: raw?.lastUsed ?? {}, quota: raw?.quota ?? {} };
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
        }
        this.touch();
    }

    recordQuota(keyId: string, windows: QuotaWindow[]): void {
        const previous = this.data.quota[keyId];
        if (!windows.length && previous?.windows.length && Date.now() - previous.capturedAt < QUOTA_STALE_MS) {
            return;
        }
        this.data.quota[keyId] = { capturedAt: Date.now(), windows };
        this.touch();
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
        delete this.data.lastUsed[keyId];
        delete this.data.quota[keyId];
        this.windowUsage.delete(keyId);
        this.cooldowns.delete(keyId);
        this.invalid.delete(keyId);
        this.touch();
    }

    dispose(): void {
        clearTimeout(this.saveTimer);
        clearTimeout(this.notifyTimer);
        void this.context.globalState.update(STORAGE_KEY, this.data);
        this.changed.dispose();
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
        for (const day of Object.keys(this.data.days)) {
            if (day < cutoff) {
                delete this.data.days[day];
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
