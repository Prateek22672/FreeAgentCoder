import * as vscode from 'vscode';
import {
    dangerousReason,
    displayPath,
    lineDiff,
    type AgentEvent,
    type ApprovalDecision,
    type ApprovalRequest,
    type ModelRouter,
} from '@agentic/core';
import { createLocalAgent, loadConfig, type AgenticConfig, type LocalAgent } from '@agentic/core/node';
import { compactNumber, errorMessage } from '../shared/format';
import type { ApprovalView, ChangedFile, PermissionMode, Tier, ToolDisplayView, ToWebview, TurnEndReason } from '../shared/protocol';
import type { DiffDocuments } from './diffDocuments';
import { EXTRA_INSTRUCTIONS } from './instructions';
import { projectSnapshot } from './projectSnapshot';

type ToolEndEvent = Extract<AgentEvent, { type: 'tool_end' }>;
type RawDisplay = NonNullable<ToolEndEvent['result']['display']>;

const MAX_STEPS = 150;
const DIFF_LINES = 400;
const OUTPUT_CHARS = 8_000;

export interface TurnPlan {
    tier: Tier;
    tierReason: string;
    /** The user pinned a specific model, so no tier was chosen. */
    pinned: boolean;
    notes: string[];
}

interface TouchedFile {
    created: boolean;
    before: string;
    after: string;
    diffId: string;
}

interface ActiveTurn {
    id: string;
    startedAt: number;
    tokensAtStart: number;
    files: Map<string, TouchedFile>;
    stopRequested: boolean;
}

export interface SessionOptions {
    router: ModelRouter;
    diffs: DiffDocuments;
    post(message: ToWebview): void;
    mode(): PermissionMode;
}

/** One conversation with the engine: runs turns and translates its events for the webview. */
export class AgentSession implements vscode.Disposable {
    private local?: LocalAgent;
    private localRoot?: string;
    private creating?: Promise<LocalAgent>;
    private abort?: AbortController;
    private turn?: ActiveTurn;
    private runPromise?: Promise<void>;
    private readonly approvals = new Map<string, (decision: ApprovalDecision) => void>();
    private approvalCount = 0;
    private turnCount = 0;
    private undoableTurn?: string;
    lastTier?: Tier;

    constructor(private readonly options: SessionOptions) {}

    get running(): boolean {
        return this.turn !== undefined;
    }

    get turnId(): string | undefined {
        return this.turn?.id;
    }

    usageInfo(): { sessionTokens: number; contextTokens: number; contextLimit: number } {
        const agent = this.local?.agent;
        if (!agent) {
            return { sessionTokens: 0, contextTokens: 0, contextLimit: 0 };
        }
        return {
            sessionTokens: agent.usage.inputTokens + agent.usage.outputTokens,
            contextTokens: agent.contextTokens(),
            contextLimit: agent.contextLimit(),
        };
    }

    run(cwd: string, prompt: string, plan: TurnPlan): Promise<void> {
        this.runPromise = this.execute(cwd, prompt, plan);
        return this.runPromise;
    }

    stop(): void {
        if (!this.turn) {
            return;
        }
        this.turn.stopRequested = true;
        this.abort?.abort();
        for (const resolve of [...this.approvals.values()]) {
            resolve({ allow: false, feedback: 'The user stopped the task.' });
        }
    }

    resolveApproval(id: string, decision: ApprovalDecision): void {
        this.approvals.get(id)?.(decision);
    }

    setMode(mode: PermissionMode): void {
        if (this.local) {
            this.local.agent.permissions.mode = mode;
        }
    }

    async newChat(): Promise<void> {
        this.stop();
        await this.runPromise?.catch(() => undefined);
        this.local?.agent.clear();
        this.undoableTurn = undefined;
        this.lastTier = undefined;
        this.options.diffs.clear();
    }

    async undo(turnId: string): Promise<void> {
        const local = this.local;
        if (this.running || !local || turnId !== this.undoableTurn) {
            this.options.post({ type: 'toast', level: 'error', message: 'Only the latest changes can be undone, after the task has finished.' });
            return;
        }
        this.undoableTurn = undefined;
        const result = await local.agent.undo();
        if (!result) {
            this.options.post({ type: 'toast', level: 'info', message: 'There is nothing to undo.' });
            return;
        }
        this.options.post({
            type: 'undone',
            turnId,
            restored: result.restored.map((p) => displayPath(local.workspace, p)),
            deleted: result.deleted.map((p) => displayPath(local.workspace, p)),
        });
    }

    resetWorkspace(): void {
        if (this.running) {
            return;
        }
        this.local?.processes.killAll();
        this.local = undefined;
        this.localRoot = undefined;
    }

    dispose(): void {
        this.stop();
        this.local?.processes.killAll();
    }

    private async execute(cwd: string, prompt: string, plan: TurnPlan): Promise<void> {
        const turn: ActiveTurn = {
            id: `turn-${Date.now().toString(36)}-${++this.turnCount}`,
            startedAt: Date.now(),
            tokensAtStart: 0,
            files: new Map(),
            stopRequested: false,
        };
        this.turn = turn;
        this.lastTier = plan.tier;
        this.options.post({ type: 'turnStart', turnId: turn.id, prompt, tier: plan.tier, tierReason: plan.tierReason, pinned: plan.pinned, at: turn.startedAt });
        for (const note of plan.notes) {
            this.options.post({ type: 'notice', turnId: turn.id, message: note, level: 'info' });
        }

        let reason: TurnEndReason = 'error';
        let steps = 0;
        try {
            const local = await this.ensureAgent(cwd, turn.id);
            if (turn.stopRequested) {
                reason = 'aborted';
                return;
            }
            const agent = local.agent;
            agent.permissions.mode = this.options.mode();
            turn.tokensAtStart = agent.usage.inputTokens + agent.usage.outputTokens;
            this.abort = new AbortController();
            for await (const event of agent.run(prompt, { signal: this.abort.signal })) {
                if (event.type === 'done') {
                    reason = event.reason;
                    steps = event.steps;
                } else {
                    this.forward(turn.id, event);
                }
            }
        } catch (error) {
            this.postError(turn.id, errorMessage(error));
        } finally {
            this.finish(turn, reason, steps);
        }
    }

    private finish(turn: ActiveTurn, reason: TurnEndReason, steps: number): void {
        for (const resolve of [...this.approvals.values()]) {
            resolve({ allow: false, feedback: 'The task ended before this was approved.' });
        }
        this.turn = undefined;
        this.abort = undefined;

        const files: ChangedFile[] = [];
        for (const [path, file] of turn.files) {
            const diff = lineDiff(file.before, file.after, 0);
            const added = diff.filter((l) => l.kind === 'add').length;
            const removed = diff.filter((l) => l.kind === 'del').length;
            if (added || removed || file.created) {
                files.push({ path, created: file.created, added, removed, diffId: file.diffId });
            }
        }

        const agent = this.local?.agent;
        const tokens = agent ? agent.usage.inputTokens + agent.usage.outputTokens - turn.tokensAtStart : 0;
        const canUndo = files.length > 0 && !!agent?.canUndo;
        if (canUndo) {
            this.undoableTurn = turn.id;
        }
        this.options.post({
            type: 'turnEnd',
            turnId: turn.id,
            reason,
            steps,
            durationMs: Date.now() - turn.startedAt,
            tokens,
            files,
            canUndo,
        });
        this.options.post({ type: 'usage', ...this.usageInfo() });
    }

    private forward(turnId: string, event: AgentEvent): void {
        const post = this.options.post;
        switch (event.type) {
            case 'text':
                post({ type: 'text', turnId, delta: event.delta });
                break;
            case 'reasoning':
                post({ type: 'reasoning', turnId, delta: event.delta });
                break;
            case 'reset':
                post({ type: 'resetText', turnId });
                break;
            case 'assistant':
                post({ type: 'assistant', turnId, content: event.message.content });
                break;
            case 'tool_call_streaming':
                post({ type: 'preparing', turnId, tool: event.name });
                break;
            case 'tool_start':
                post({ type: 'toolStart', turnId, callId: event.call.id, tool: event.call.name, label: event.label });
                break;
            case 'tool_output':
                post({ type: 'toolOutput', turnId, callId: event.callId, chunk: event.chunk });
                break;
            case 'tool_end':
                this.toolEnd(turnId, event);
                break;
            case 'todos':
                post({ type: 'todos', turnId, todos: event.todos.map((t) => ({ content: t.content, status: t.status })) });
                break;
            case 'notice':
                post({
                    type: 'notice',
                    turnId,
                    message: event.message,
                    level: /failed|rate-limited|switching|waiting|unavailable|couldn't/i.test(event.message) ? 'warn' : 'info',
                });
                break;
            case 'compacted':
                if (event.kind === 'summary') {
                    post({
                        type: 'notice',
                        turnId,
                        level: 'info',
                        message: `Summarized earlier messages to free up context (${compactNumber(event.before)} → ${compactNumber(event.after)} tokens).`,
                    });
                }
                break;
            case 'usage':
                post({ type: 'usage', ...this.usageInfo() });
                break;
            case 'error':
                this.postError(turnId, event.message);
                break;
            default:
                break;
        }
    }

    private toolEnd(turnId: string, event: ToolEndEvent): void {
        const raw = event.result.display;
        const ok = !event.result.isError;
        const display = raw ? this.displayView(raw) : undefined;
        let diffId: string | undefined;
        if (ok && raw?.type === 'diff') {
            diffId = this.recordFile(raw.path, raw.before, raw.after, raw.created);
        }
        this.options.post({
            type: 'toolEnd',
            turnId,
            callId: event.call.id,
            tool: event.call.name,
            label: event.label,
            ok,
            denied: !!event.denied,
            summary: event.result.summary,
            display,
            diffId,
            error: ok ? undefined : event.result.content.slice(0, 600),
        });
    }

    private displayView(raw: RawDisplay): ToolDisplayView | undefined {
        switch (raw.type) {
            case 'diff': {
                const all = lineDiff(raw.before, raw.after, 2);
                const lines = all.slice(0, DIFF_LINES);
                return {
                    type: 'diff',
                    path: raw.path,
                    created: raw.created,
                    lines,
                    added: all.filter((l) => l.kind === 'add').length,
                    removed: all.filter((l) => l.kind === 'del').length,
                    truncated: all.length > lines.length,
                };
            }
            case 'command':
                return {
                    type: 'command',
                    command: raw.command,
                    output: raw.output.slice(-OUTPUT_CHARS),
                    exitCode: raw.exitCode,
                    timedOut: raw.timedOut,
                    background: raw.background,
                };
            case 'text':
                return { type: 'text', text: raw.text.slice(0, OUTPUT_CHARS) };
            default:
                return undefined;
        }
    }

    private recordFile(path: string, before: string, after: string, created: boolean): string | undefined {
        const turn = this.turn;
        if (!turn) {
            return undefined;
        }
        const previous = turn.files.get(path);
        const file: TouchedFile = previous
            ? { ...previous, after }
            : { created, before, after, diffId: `${turn.id}-${turn.files.size + 1}` };
        turn.files.set(path, file);
        this.options.diffs.set(file.diffId, file.before, file.after);
        return file.diffId;
    }

    private readonly approve = (request: ApprovalRequest): Promise<ApprovalDecision> => {
        const turnId = this.turn?.id;
        if (!turnId) {
            return Promise.resolve({ allow: false, feedback: 'There is no active task.' });
        }
        const id = `approval-${++this.approvalCount}`;
        const approval: ApprovalView = {
            id,
            tool: request.tool,
            kind: request.kind,
            label: request.label,
            reason: request.reason,
            command: request.command,
            url: request.url,
            paths: request.paths,
            outsideProject: request.outsideProject,
            canRemember: request.canRemember,
            dangerous: !!(request.command && dangerousReason(request.command)),
            preview: request.preview ? this.displayView(request.preview) : undefined,
        };
        return new Promise((resolve) => {
            this.approvals.set(id, (decision) => {
                this.approvals.delete(id);
                this.options.post({ type: 'approvalResolved', turnId, id, allowed: decision.allow });
                resolve(decision);
            });
            this.options.post({ type: 'approval', turnId, approval });
        });
    };

    private ensureAgent(cwd: string, turnId: string): Promise<LocalAgent> {
        if (this.local && this.localRoot === cwd) {
            return Promise.resolve(this.local);
        }
        this.creating ??= (async () => {
            let config: AgenticConfig = {};
            try {
                config = await loadConfig();
            } catch (error) {
                this.options.post({ type: 'notice', turnId, level: 'warn', message: `Ignoring the Agentic CLI config: ${errorMessage(error)}` });
            }
            this.local?.processes.killAll();
            const local = await createLocalAgent({
                cwd,
                config,
                router: this.options.router,
                mode: this.options.mode(),
                approve: this.approve,
                agentName: 'FreeAgentCoder',
                extraInstructions: [EXTRA_INSTRUCTIONS, await projectSnapshot(cwd)].filter(Boolean).join('\n\n'),
                maxSteps: MAX_STEPS,
            });
            this.local = local;
            this.localRoot = cwd;
            return local;
        })().finally(() => {
            this.creating = undefined;
        });
        return this.creating;
    }

    private postError(turnId: string, message: string): void {
        let hint: string | undefined;
        let action: 'openKeys' | undefined;
        if (/Every model failed|No model is configured/.test(message)) {
            hint = "None of your keys could complete this request. Check each key's status and quota in Settings → API Keys, or add another key.";
            action = 'openKeys';
        } else if (/larger than any configured model/.test(message)) {
            hint = 'This conversation no longer fits your models. Start a new chat, or add a Gemini key for its 1M-token context.';
        } else if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(message)) {
            hint = 'Check your internet connection and try again.';
        }
        this.options.post({ type: 'error', turnId, message, hint, action });
    }
}
