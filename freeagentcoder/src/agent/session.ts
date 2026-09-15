import * as vscode from 'vscode';
import {
    dangerousReason,
    displayPath,
    lineDiff,
    type AgentEvent,
    type ApprovalDecision,
    type ApprovalRequest,
    type AssistantMessage,
    type ImagePart,
    type Message,
    type ModelRouter,
    type SearchHit,
    type Todo,
} from '@agentic/core';
import { createLocalAgent, loadConfig, type AgenticConfig, type LocalAgent } from '@agentic/core/node';
import { compactNumber, errorMessage } from '../shared/format';
import type { ApprovalView, AttachmentView, ChangedFile, PermissionMode, Tier, ToolDisplayView, ToWebview, TurnEndReason } from '../shared/protocol';
import type { DiffDocuments } from './diffDocuments';
import { EXTRA_INSTRUCTIONS } from './instructions';
import { evaluateGates, reviewMessage, type CommandRun, type Playbook } from './playbooks';
import { projectSnapshot } from './projectSnapshot';

type ToolEndEvent = Extract<AgentEvent, { type: 'tool_end' }>;
type RawDisplay = NonNullable<ToolEndEvent['result']['display']>;

const MAX_STEPS = 150;
const DIFF_LINES = 400;
const OUTPUT_CHARS = 8_000;
const RESUME_PROMPT = 'Continue the task from where you stopped. (The editor resumed it automatically after a temporary problem reaching the AI providers.)';
const TEMPORARY =
    /rate limit|rate-limited|cooling down|too many requests|timed out|timeout|network|fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|server error|overloaded|unavailable|stream ended early|\b50[0-4]\b/i;
const OFFLINE = /fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i;
const FINAL = /larger than any configured model|declined to continue|No model is configured/i;

/** Whether a turn-ending error is temporary enough to wait out and resume automatically. */
export function recoveryFor(message: string, attempt: number): { delayMs: number; explanation: string; action: string } | undefined {
    if (attempt >= 2 || FINAL.test(message)) {
        return undefined;
    }
    const reasons = message.startsWith('Every model failed') ? message.split('\n').slice(1) : [message];
    if (!reasons.some((line) => TEMPORARY.test(line))) {
        return undefined;
    }
    const delayMs = attempt === 0 ? 30_000 : 90_000;
    return {
        delayMs,
        explanation: reasons.every((line) => OFFLINE.test(line)) ? 'The connection to the AI providers dropped.' : 'Every model is busy or rate-limited right now.',
        action: `Waited ${delayMs / 1000}s and resumed the task`,
    };
}

export interface TurnPlan {
    tier: Tier;
    tierReason: string;
    /** The user pinned a specific model, so no tier was chosen. */
    pinned: boolean;
    notes: string[];
    /** What the agent receives: the request, plus the task brief, lessons and relevant files when they apply. */
    agentPrompt: string;
    playbooks: Playbook[];
    /** The request asks for a publish-ready result, so release gates are required. */
    release: boolean;
    /** The user is correcting earlier work. */
    correction: boolean;
    attachments: AttachmentView[];
    /** How many saved lessons were added to the prompt. */
    lessons: number;
    /** Reads attachments inside the turn (so progress shows and Stop works), returning the final prompt and images. */
    prepare?: (turnId: string, signal: AbortSignal) => Promise<{ agentPrompt: string; images: ImagePart[] }>;
}

export interface SessionLogEntry {
    kind: 'agent';
    source: string;
    message: string;
    recovered: boolean;
    action?: string;
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
    runs: CommandRun[];
    playbooks: Playbook[];
    release: boolean;
    stopRequested: boolean;
    /** Ends an automatic-retry wait early (when the user stops the task). */
    wake?: () => void;
}

export interface SessionOptions {
    router: ModelRouter;
    diffs: DiffDocuments;
    post(message: ToWebview): void;
    mode(): PermissionMode;
    log(entry: SessionLogEntry): void;
    features(): { autoRecovery: boolean };
}

/** One conversation with the engine: runs turns and translates its events for the webview. */
export class AgentSession implements vscode.Disposable {
    private local?: LocalAgent;
    private localRoot?: string;
    private creating?: Promise<LocalAgent>;
    private abort?: AbortController;
    private turn?: ActiveTurn;
    private runPromise?: Promise<void>;
    private pendingRestore?: { messages: Message[]; todos: Todo[] };
    private readonly approvals = new Map<string, (decision: ApprovalDecision) => void>();
    private approvalCount = 0;
    private turnCount = 0;
    private undoableTurn?: string;
    lastTier?: Tier;
    /** Carried into follow-ups like "continue", so the same checks still apply. */
    lastPlaybooks: Playbook[] = [];
    lastRelease = false;

    constructor(private readonly options: SessionOptions) {}

    get running(): boolean {
        return this.turn !== undefined;
    }

    get turnId(): string | undefined {
        return this.turn?.id;
    }

    /** Whether this chat already has earlier work the user could be correcting. */
    get hasHistory(): boolean {
        return (this.local?.agent.messages.length ?? 0) > 0 || !!this.pendingRestore?.messages.length;
    }

    /** Files in the local code index, once it has been built. */
    get indexedFiles(): number | undefined {
        return this.local?.codeIndex.fileCount || undefined;
    }

    /** The agent's latest non-empty reply. */
    lastReply(): string {
        const messages = this.local?.agent.messages ?? [];
        for (let i = messages.length - 1; i >= 0; i--) {
            const message = messages[i];
            if (message.role === 'assistant' && message.content.trim()) {
                return message.content;
            }
        }
        return '';
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

    /** The conversation as the agent sees it, for saving to history. */
    snapshot(): { messages: Message[]; todos: Todo[] } {
        const agent = this.local?.agent;
        if (agent) {
            return { messages: [...agent.messages], todos: [...agent.todos] };
        }
        return { messages: [...(this.pendingRestore?.messages ?? [])], todos: [...(this.pendingRestore?.todos ?? [])] };
    }

    /** Continue a saved conversation: the agent gets its earlier messages and plan back. */
    async restore(messages: Message[], todos: Todo[]): Promise<void> {
        await this.newChat();
        if (this.local) {
            this.local.agent.messages = [...messages];
            this.local.agent.todos = [...todos];
        } else {
            this.pendingRestore = { messages, todos };
        }
    }

    /** Files most related to a request, from the project's local search index. */
    async relevantFiles(cwd: string, query: string, limit: number): Promise<SearchHit[]> {
        const local = await this.ensureAgent(cwd);
        await local.codeIndex.ensureFresh();
        return local.codeIndex.search(query, limit);
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
        this.turn.wake?.();
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
        this.pendingRestore = undefined;
        this.undoableTurn = undefined;
        this.lastTier = undefined;
        this.lastPlaybooks = [];
        this.lastRelease = false;
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
            runs: [],
            playbooks: plan.playbooks,
            release: plan.release,
            stopRequested: false,
        };
        this.turn = turn;
        this.lastTier = plan.tier;
        this.lastPlaybooks = plan.playbooks;
        this.lastRelease = plan.release;
        this.options.post({
            type: 'turnStart',
            turnId: turn.id,
            prompt,
            tier: plan.tier,
            tierReason: plan.tierReason,
            pinned: plan.pinned,
            playbooks: plan.playbooks.map((p) => p.name),
            at: turn.startedAt,
            attachments: plan.attachments.length ? plan.attachments : undefined,
            correction: plan.correction || undefined,
            lessons: plan.lessons || undefined,
        });
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

            let input = plan.agentPrompt;
            let images: ImagePart[] | undefined;
            if (plan.prepare) {
                const prepared = await plan.prepare(turn.id, this.abort.signal);
                if (turn.stopRequested) {
                    reason = 'aborted';
                    return;
                }
                input = prepared.agentPrompt;
                images = prepared.images;
            }

            for (let attempt = 0; ; attempt++) {
                const outcome = await this.runAgent(agent, input, turn.id, attempt === 0 ? images : undefined);
                steps += outcome.steps;
                reason = outcome.reason;
                if (reason !== 'error' || outcome.error === undefined) {
                    break;
                }
                const recoveryOn = this.options.features().autoRecovery;
                const recovery = turn.stopRequested || !recoveryOn ? undefined : recoveryFor(outcome.error, attempt);
                if (!recovery) {
                    this.postError(turn.id, outcome.error);
                    this.options.log({
                        kind: 'agent',
                        source: 'Task',
                        message: outcome.error,
                        recovered: false,
                        action: attempt
                            ? `Stopped after ${attempt} automatic ${attempt === 1 ? 'retry' : 'retries'}`
                            : recoveryOn
                              ? 'Stopped the task and showed the error'
                              : 'Stopped the task (automatic recovery is off)',
                    });
                    break;
                }
                this.options.log({ kind: 'agent', source: 'Task', message: outcome.error, recovered: true, action: recovery.action });
                this.options.post({
                    type: 'notice',
                    turnId: turn.id,
                    level: 'warn',
                    message: `${recovery.explanation} Retrying automatically in ${Math.round(recovery.delayMs / 1000)}s. Press Stop to cancel.`,
                });
                await this.pause(turn, recovery.delayMs);
                if (turn.stopRequested) {
                    reason = 'aborted';
                    break;
                }
                input = RESUME_PROMPT;
            }
        } catch (error) {
            if (turn.stopRequested) {
                reason = 'aborted';
            } else {
                this.postError(turn.id, errorMessage(error));
                this.options.log({ kind: 'agent', source: 'Task', message: errorMessage(error), recovered: false, action: 'Stopped the task and showed the error' });
            }
        } finally {
            this.finish(turn, reason, steps);
        }
    }

    private async runAgent(
        agent: LocalAgent['agent'],
        input: string,
        turnId: string,
        images?: ImagePart[],
    ): Promise<{ reason: TurnEndReason; steps: number; error?: string }> {
        let reason: TurnEndReason = 'error';
        let steps = 0;
        let error: string | undefined;
        for await (const event of agent.run(input, { signal: this.abort?.signal, images })) {
            if (event.type === 'done') {
                reason = event.reason;
                steps = event.steps;
            } else if (event.type === 'error') {
                error = event.message;
            } else {
                this.forward(turnId, event);
            }
        }
        return { reason, steps, error };
    }

    private pause(turn: ActiveTurn, ms: number): Promise<void> {
        return new Promise((resolve) => {
            const timer = setTimeout(done, ms);
            function done(): void {
                clearTimeout(timer);
                turn.wake = undefined;
                resolve();
            }
            turn.wake = done;
        });
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

        if (turn.playbooks.length && (turn.runs.length || turn.files.size)) {
            this.options.post({
                type: 'checks',
                turnId: turn.id,
                playbooks: turn.playbooks.map((p) => p.name),
                gates: evaluateGates(turn.playbooks, turn.runs, turn.release),
                security: [...new Set(turn.playbooks.flatMap((p) => p.security))],
                release: turn.release ? [...new Set(turn.playbooks.flatMap((p) => p.release))] : [],
            });
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
        if (raw?.type === 'command' && event.call.name === 'run_command') {
            this.turn?.runs.push({ command: raw.command, exitCode: raw.exitCode, background: !!raw.background });
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
        const file: TouchedFile = previous ? { ...previous, after } : { created, before, after, diffId: `${turn.id}-${turn.files.size + 1}` };
        turn.files.set(path, file);
        this.options.diffs.set(file.diffId, file.before, file.after);
        return file.diffId;
    }

    /** Before the agent ends a turn, required quality gates must have passed. */
    private readonly reviewCompletion = (message: AssistantMessage): string | undefined => {
        const turn = this.turn;
        if (!turn?.playbooks.length || (!turn.files.size && !turn.runs.length)) {
            return undefined;
        }
        return reviewMessage(evaluateGates(turn.playbooks, turn.runs, turn.release), message.content);
    };

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

    private ensureAgent(cwd: string, turnId?: string): Promise<LocalAgent> {
        if (this.local && this.localRoot === cwd) {
            return Promise.resolve(this.local);
        }
        this.creating ??= (async () => {
            let config: AgenticConfig = {};
            try {
                config = await loadConfig();
            } catch (error) {
                if (turnId) {
                    this.options.post({ type: 'notice', turnId, level: 'warn', message: `Ignoring the Agentic CLI config: ${errorMessage(error)}` });
                }
            }
            this.local?.processes.killAll();
            const restore = this.pendingRestore;
            this.pendingRestore = undefined;
            const local = await createLocalAgent({
                cwd,
                config,
                router: this.options.router,
                mode: this.options.mode(),
                approve: this.approve,
                reviewCompletion: this.reviewCompletion,
                messages: restore?.messages,
                todos: restore?.todos,
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
            hint = "None of your keys could complete this request. Check each key's status and last error in Settings → API Keys, or add another key.";
            action = 'openKeys';
        } else if (/larger than any configured model/.test(message)) {
            hint = 'This conversation no longer fits your models. Start a new chat, or add a Gemini key for its 1M-token context.';
        } else if (OFFLINE.test(message)) {
            hint = 'Check your internet connection and try again.';
        }
        this.options.post({ type: 'error', turnId, message, hint, action });
    }
}
