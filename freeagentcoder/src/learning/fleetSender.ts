import type * as vscode from 'vscode';
import { SITE_URL } from '../shared/site';
import type { Telemetry } from '../telemetry/telemetry';
import { emptyQueue, enqueue, queueSize, type Queue } from './fleet';

const QUEUE = 'freeagentcoder.learning.queue';
const SENT = 'freeagentcoder.learning.sent';
/** At most one batch every two minutes; a busy session sends a few tasks at a time. */
const EVERY_MS = 2 * 60_000;
const TIMEOUT_MS = 8_000;

/**
 * Sends what this install learned, only while sharing is on (the user chose
 * "OK, start using the agent" and VS Code's telemetry is on). While it is
 * off, nothing is even queued.
 */
export class FleetSender {
    private queue: Queue;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly telemetry: Telemetry,
    ) {
        this.queue = { ...emptyQueue(), ...context.globalState.get<Queue>(QUEUE, emptyQueue()) };
    }

    get sharing(): boolean {
        return this.telemetry.state === 'on';
    }

    add<K extends keyof Queue>(key: K, items: Queue[K]): void {
        if (!this.sharing || !(items as unknown[]).length) {
            return;
        }
        this.queue = enqueue(this.queue, key, items);
        void this.context.globalState.update(QUEUE, this.queue);
    }

    /** The batch that would be sent now, for "See exactly what is sent". */
    preview(): Record<string, unknown> {
        return { v: 1, install: '(a random id made on this install)', extension: String(this.context.extension.packageJSON.version ?? ''), ...this.queue };
    }

    async flush(force = false): Promise<void> {
        if (!this.sharing || !queueSize(this.queue)) {
            return;
        }
        const last = this.context.globalState.get<number>(SENT) ?? 0;
        if (!force && Date.now() - last < EVERY_MS) {
            return;
        }
        const batch = this.queue;
        try {
            const response = await fetch(`${SITE_URL}/api/learn`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ v: 1, install: this.telemetry.installId(), extension: String(this.context.extension.packageJSON.version ?? ''), ...batch }),
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            // A refused batch would be refused again: drop it rather than retry forever.
            if (!response.ok && response.status < 400) {
                return;
            }
        } catch {
            return;
        }
        // Items added while sending stay for next time.
        const sent = new Set<unknown>(Object.values(batch).flat());
        this.queue = Object.fromEntries(Object.entries(this.queue).map(([k, list]) => [k, (list as unknown[]).filter((item) => !sent.has(item))])) as unknown as Queue;
        await this.context.globalState.update(QUEUE, this.queue);
        await this.context.globalState.update(SENT, Date.now());
    }
}
