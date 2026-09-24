import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { addFailure, buildReport, describeReport, emptyCounters, type Counters, type Report } from './payload';

/**
 * Anonymous counts, sent only if the user says yes.
 *
 * Off until asked, asked once, and never asked at all when VS Code's own
 * telemetry is turned off. What it answers is narrow and practical: how many
 * keys people actually have, which providers, and what stops tasks — the
 * things that decide what to fix next and how many free keys are enough.
 */

const CONSENT = 'freeagentcoder.telemetry.consent';
const ASKED = 'freeagentcoder.telemetry.asked';
const INSTALL = 'freeagentcoder.telemetry.install';
const COUNTERS = 'freeagentcoder.telemetry.counters';
const SINCE = 'freeagentcoder.telemetry.since';
const SENT = 'freeagentcoder.telemetry.sent';

/**
 * The project's own site, unless someone points this elsewhere. When the site
 * moves to its own domain, keep a 308 redirect on this address: a 308 preserves
 * the method and the body, so already-published releases keep reporting.
 */
const DEFAULT_ENDPOINT = 'https://brain-rho-roan.vercel.app/api/stats';

const SEND_EVERY_MS = 12 * 60 * 60 * 1000;
const SEND_TIMEOUT_MS = 8_000;
/** Asked only once there is something worth reporting. */
const ASK_AFTER_TASKS = 3;

/**
 * Settable, so the site can move without stranding published releases. The
 * setting is application-scoped, so a project cannot redirect it, and only
 * https is accepted, so it cannot be downgraded.
 */
function endpoint(): string {
    const configured = vscode.workspace.getConfiguration('freeagentcoder').get<string>('usageDataEndpoint')?.trim();
    if (configured && /^https:\/\//i.test(configured)) {
        return configured;
    }
    return process.env.FREEAGENTCODER_STATS_URL || DEFAULT_ENDPOINT;
}

export type TelemetryState = 'on' | 'off' | 'unasked' | 'blocked';

export interface KeySnapshot {
    count: number;
    providers: string[];
}

export class Telemetry {
    private counters: Counters;
    private saving?: NodeJS.Timeout;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly keys: () => KeySnapshot,
    ) {
        const saved = context.globalState.get<Counters>(COUNTERS);
        this.counters = saved && typeof saved.tasks === 'number' ? { ...emptyCounters(), ...saved } : emptyCounters();
    }

    get state(): TelemetryState {
        if (!vscode.env.isTelemetryEnabled) {
            return 'blocked';
        }
        const choice = this.context.globalState.get<string>(CONSENT);
        if (choice === 'on' || choice === 'off') {
            return choice;
        }
        return 'unasked';
    }

    /** Counts a finished task. Kept on this computer whether or not it is ever sent. */
    taskFinished(outcome: 'done' | 'stopped' | 'failed', cause?: string): void {
        this.counters.tasks += 1;
        if (outcome === 'done') {
            this.counters.tasksDone += 1;
        } else if (outcome === 'stopped') {
            this.counters.tasksStopped += 1;
        } else {
            this.counters.tasksFailed += 1;
            if (cause) {
                addFailure(this.counters, cause);
            }
        }
        this.save();
        void this.afterTask();
    }

    imageRead(where: 'locally' | 'model'): void {
        if (where === 'locally') {
            this.counters.readLocally += 1;
        } else {
            this.counters.readByModel += 1;
        }
        this.save();
    }

    /** The exact report that would be sent right now. */
    report(): Report {
        const keys = this.keys();
        return buildReport({
            install: this.installId(),
            extension: String(this.context.extension.packageJSON.version ?? '0.0.0'),
            editor: vscode.version,
            platform: process.platform,
            since: this.context.globalState.get<number>(SINCE) ?? Date.now(),
            now: Date.now(),
            providers: keys.providers,
            keyCount: keys.count,
            counters: this.counters,
        });
    }

    /** The command: shows what would be sent, and lets the choice be made or changed. */
    async choose(): Promise<void> {
        if (this.state === 'blocked') {
            await vscode.window.showInformationMessage(
                'Telemetry is turned off for the whole editor in VS Code settings, so FreeAgentCoder sends nothing. Turn that on first if you want to share anonymous counts.',
            );
            return;
        }
        const on = this.state === 'on';
        const choice = await vscode.window.showInformationMessage(
            on
                ? 'FreeAgentCoder is sending anonymous counts: how many keys you have and which providers, how many tasks ran, and what stopped them. No code, prompts, file names or keys.'
                : 'Send anonymous counts? How many keys you have and which providers, how many tasks ran, and what stopped them. It decides what gets fixed next. No code, prompts, file names or keys, ever.',
            on ? 'Stop sending' : 'Send anonymous counts',
            'Show me what is sent',
        );
        if (choice === 'Show me what is sent') {
            const document = await vscode.workspace.openTextDocument({ language: 'json', content: describeReport(this.report()) });
            await vscode.window.showTextDocument(document, { preview: true });
            return this.choose();
        }
        if (choice === 'Stop sending') {
            await this.context.globalState.update(CONSENT, 'off');
        } else if (choice === 'Send anonymous counts') {
            await this.context.globalState.update(CONSENT, 'on');
            await this.context.globalState.update(ASKED, true);
            void this.flush(true);
        }
    }

    /** Asks once, after a few tasks, so the question reaches someone who has used it. */
    private async afterTask(): Promise<void> {
        if (this.state === 'on') {
            void this.flush();
            return;
        }
        if (this.state !== 'unasked' || this.counters.tasks < ASK_AFTER_TASKS || this.context.globalState.get<boolean>(ASKED)) {
            return;
        }
        await this.context.globalState.update(ASKED, true);
        const choice = await vscode.window.showInformationMessage(
            'Help decide what gets fixed next? FreeAgentCoder can send anonymous counts — how many keys you have and which providers, how many tasks ran, and what stopped them. No code, prompts, file names or keys, ever.',
            'Yes, send counts',
            'No thanks',
            'Show me what is sent',
        );
        if (choice === 'Show me what is sent') {
            return this.choose();
        }
        await this.context.globalState.update(CONSENT, choice === 'Yes, send counts' ? 'on' : 'off');
        if (choice === 'Yes, send counts') {
            void this.flush(true);
        }
    }

    async flush(force = false): Promise<void> {
        if (this.state !== 'on') {
            return;
        }
        const last = this.context.globalState.get<number>(SENT) ?? 0;
        if (!force && Date.now() - last < SEND_EVERY_MS) {
            return;
        }
        const report = this.report();
        try {
            const response = await fetch(endpoint(), {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(report),
                signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
            });
            if (!response.ok) {
                return;
            }
        } catch {
            // Never worth bothering the user about, and never worth retrying hard.
            return;
        }
        this.counters = emptyCounters();
        await this.context.globalState.update(COUNTERS, this.counters);
        await this.context.globalState.update(SINCE, Date.now());
        await this.context.globalState.update(SENT, Date.now());
    }

    private installId(): string {
        let id = this.context.globalState.get<string>(INSTALL);
        if (!id) {
            id = randomUUID();
            void this.context.globalState.update(INSTALL, id);
            void this.context.globalState.update(SINCE, Date.now());
        }
        return id;
    }

    /** Written back rarely: counters change often and none of it is urgent. */
    private save(): void {
        clearTimeout(this.saving);
        this.saving = setTimeout(() => void this.context.globalState.update(COUNTERS, this.counters), 2_000);
    }

    dispose(): void {
        clearTimeout(this.saving);
        void this.context.globalState.update(COUNTERS, this.counters);
    }
}
