import * as vscode from 'vscode';
import type { LogEntry, LogKind, LogStats } from '../shared/protocol';
import { dayKey } from '../usage/usageStore';

const STORAGE_KEY = 'freeagentcoder.errorLog.v1';
const LIMIT = 300;

/** Masks anything that looks like an API key or token before it is stored or copied. */
export function redact(text: string): string {
    return text
        .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]')
        .replace(/\b((?:api[_-]?key|key|token|access_token|secret|password)["']?\s*[=:]\s*["']?)[^\s"'&,;]+/gi, '$1[redacted]')
        .replace(/\b(?:sk|gsk|csk|xai|hf|or)[-_][A-Za-z0-9_-]{10,}|\bAIza[0-9A-Za-z_-]{20,}|[A-Za-z0-9_-]{40,}/g, '[redacted]')
        .replace(/([A-Za-z]:[\\/]Users[\\/]|\/Users\/|\/home\/)[^\\/\s:'"]+/gi, '$1<user>');
}

/** A local log of errors and what was done about them. Repeats within two minutes are counted, not duplicated. */
export class ErrorLog implements vscode.Disposable {
    private entries: LogEntry[];
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChange = this.changed.event;
    private saveTimer?: ReturnType<typeof setTimeout>;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.entries = context.globalState.get<LogEntry[]>(STORAGE_KEY, []);
    }

    add(entry: { kind: LogKind; source: string; message: string; recovered: boolean; action?: string }): void {
        const now = Date.now();
        const message = redact(entry.message).slice(0, 500);
        const similar = this.entries
            .slice(0, 10)
            .find((e) => e.kind === entry.kind && e.source === entry.source && e.message === message && now - e.at < 120_000);
        if (similar) {
            similar.count++;
            similar.at = now;
            similar.recovered = entry.recovered;
            similar.action = entry.action ?? similar.action;
            this.entries = [similar, ...this.entries.filter((e) => e !== similar)];
        } else {
            this.entries.unshift({
                id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
                at: now,
                count: 1,
                kind: entry.kind,
                source: entry.source,
                message,
                recovered: entry.recovered,
                action: entry.action,
            });
            if (this.entries.length > LIMIT) {
                this.entries.length = LIMIT;
            }
        }
        this.schedule();
    }

    list(): LogEntry[] {
        return this.entries;
    }

    clear(): void {
        this.entries = [];
        this.schedule();
    }

    stats(): LogStats {
        const today = dayKey();
        const todays = this.entries.filter((e) => dayKey(e.at) === today);
        const total = (list: LogEntry[]) => list.reduce((n, e) => n + e.count, 0);
        const bySource = new Map<string, number>();
        for (const e of todays) {
            bySource.set(e.source, (bySource.get(e.source) ?? 0) + e.count);
        }
        return {
            today: total(todays),
            handled: total(todays.filter((e) => e.recovered)),
            unresolved: total(todays.filter((e) => !e.recovered)),
            topSources: [...bySource.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([source, count]) => ({ source, count })),
        };
    }

    report(header: string[]): string {
        const lines = [...header, '', 'Recent errors, newest first:'];
        for (const e of this.entries.slice(0, 60)) {
            lines.push(
                `${new Date(e.at).toISOString()} [${e.kind}] ${e.source}: ${e.message}${e.count > 1 ? ` (x${e.count})` : ''} -> ${
                    e.recovered ? `handled${e.action ? `: ${e.action}` : ''}` : `not recovered${e.action ? `: ${e.action}` : ''}`
                }`,
            );
        }
        if (!this.entries.length) {
            lines.push('None.');
        }
        return redact(lines.join('\n'));
    }

    dispose(): void {
        clearTimeout(this.saveTimer);
        void this.context.globalState.update(STORAGE_KEY, this.entries);
        this.changed.dispose();
    }

    private schedule(): void {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            void this.context.globalState.update(STORAGE_KEY, this.entries);
        }, 1_000);
        this.changed.fire();
    }
}
