import { promises as fs } from 'node:fs';
import { documentCheckTool, type VisualReview } from '../attachments/docCheck';
import { makeDeckTool } from '../attachments/deck';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    dangerousReason,
    displayPath,
    errorSignature,
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
import type { ApprovalView, AttachmentView, ChangedFile, PermissionMode, PreviewView, Tier, ToolDisplayView, ToWebview, TurnEndReason } from '../shared/protocol';
import type { DiffDocuments } from './diffDocuments';
import { editorProblemsAfterEdit, getProblemsTool } from './editorProblems';
import { editorInstructions } from './instructions';
import { completionReview, gateResults } from './gates';
import type { GateResult, Playbook } from './playbooks';
import type { ProjectCheck } from './projectChecks';
import { checkPageTool, pageFeedback, pageProblem, type PagePreviews } from '../preview/pages';
import { projectSnapshot } from './projectSnapshot';
import { explainError, isContextTooLarge, recoveryFor } from './recovery';
import { codeChanged, verificationReview, type SequencedRun } from './testing';
import { addressesIn, appAddress, appErrors, httpProbe, runProof, stillStarting, type Verdict } from './runProof';
import { isBlank } from '../preview/pages';

type ToolEndEvent = Extract<AgentEvent, { type: 'tool_end' }>;
type RawDisplay = NonNullable<ToolEndEvent['result']['display']>;

const MAX_STEPS = 150;
const DIFF_LINES = 400;
const OUTPUT_CHARS = 8_000;
const RESUME_PROMPT = 'Continue the task from where you stopped. (The editor resumed it automatically after a temporary problem reaching the AI providers.)';
/** A local address in what a dev server printed. */
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
const COMPACTED_PROMPT =
    'Continue the task from where you stopped. (The editor summarized the earlier conversation because it had grown too large for the models; re-read any file you need rather than relying on memory of its contents.)';
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
    /** A warning that today's limits may not cover this task. */
    capacity?: { level: 'tight' | 'short'; title: string; detail: string };
    /** A "Test my project" run. */
    test?: boolean;
    /** The project's own checks; a complex task that changes code must pass one before it may finish. */
    checks?: ProjectCheck[];
    /** A new request unrelated to the conversation so far: earlier tool output is not resent. */
    fresh?: boolean;
    /** Files whose contents the prompt already includes (ones the user mentioned), so they count as read. */
    knownFiles?: string[];
    /** The tools this kind of task uses (see toolsFor); undefined means all. */
    tools?: string[];
    /** Small talk or a general question: this system prompt and only the last few exchanges. */
    chat?: { system: string; history: number };
    /** Ask for a thumbs up or down at the end (the user shares what the agent learns). */
    rate?: boolean;
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
    /** The user asked for a script or for Python itself, so writing one is what they want. */
    askedForScript: boolean;
    /** Ask for a rating at the end. */
    rate?: boolean;
    startedAt: number;
    tokensAtStart: number;
    files: Map<string, TouchedFile>;
    runs: SequencedRun[];
    playbooks: Playbook[];
    release: boolean;
    stopRequested: boolean;
    deep: boolean;
    checks: ProjectCheck[];
    /** Order of edits and command runs, so a check can be matched to the edit before it. */
    seq: number;
    lastEditSeq: number;
    /** `lastEditSeq` as it was when a page was last loaded in a browser, so the same files are not checked twice. */
    pageCheckSeq?: number;
    /** Content that does not fit has been sent back once already. */
    layoutRaised?: boolean;
    /** What the editor itself verified about a running app (not what the model said), for the report. */
    evidence?: RunEvidence;
    /** Ends an automatic-retry wait early (when the user stops the task). */
    wake?: () => void;
}

interface RunEvidence {
    url: string;
    opens: true | string;
    drawn: 'yes' | 'errors' | 'unconfirmed' | 'no-browser';
    detail?: string;
    seq: number;
}

/** The report lines for a run task: what was opened and seen by the editor, never the model's word. */
function evidenceGates(evidence: RunEvidence | undefined): GateResult[] {
    const starting = evidence?.opens === 'still starting';
    const opened: GateResult = {
        label: evidence ? `Link opens: ${evidence.url}${starting ? ' (still starting)' : ''}` : 'Link opens',
        command: 'Opened by FreeAgentCoder',
        required: true,
        status: !evidence || starting ? 'not_run' : evidence.opens === true ? 'passed' : 'failed',
    };
    if (!evidence || evidence.opens !== true) {
        return [opened];
    }
    const drawn: GateResult = {
        label:
            evidence.drawn === 'yes'
                ? 'Page drawn in a hidden browser, no errors'
                : evidence.drawn === 'errors'
                  ? `Page drawn: ${evidence.detail ?? 'the browser reported errors'}`
                  : evidence.drawn === 'no-browser'
                    ? 'Page drawn: not checked (no Chrome or Edge found)'
                    : 'Page drawn: not confirmed (a debug server can wait for a debugger); open the link to look',
        command: 'Checked by FreeAgentCoder',
        required: false,
        status: evidence.drawn === 'yes' ? 'passed' : evidence.drawn === 'errors' ? 'failed' : 'not_run',
    };
    return [opened, drawn];
}

export interface SessionOptions {
    router: ModelRouter;
    diffs: DiffDocuments;
    post(message: ToWebview): void;
    mode(): PermissionMode;
    log(entry: SessionLogEntry): void;
    features(): { autoRecovery: boolean };
    /** Tokens one task may use before it pauses for the user to continue. 0: no limit. */
    taskTokenLimit(): number;
    /** Serves and checks web pages in the open folder. */
    previews: PagePreviews;
    /** Whether a web page is loaded in a hidden browser before the agent may call it done. */
    checkPages(): boolean;
    /** Has a vision model look at a rendered document, for check_document. */
    reviewDocument?: VisualReview;
}

/** One conversation with the engine: runs turns and translates its events for the webview. */
export class AgentSession implements vscode.Disposable {
    /** Watches an app left starting at the end of a task, to show its Preview when it is ready. */
    private readyWatch?: ReturnType<typeof setInterval>;
    /** Normalised errors seen in the current task, for fleet learning: signature → tool and how often. */
    private errorsThisTurn = new Map<string, { tool: string; count: number }>();
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
        this.errorsThisTurn = new Map();
        this.runPromise = this.execute(cwd, prompt, plan);
        return this.runPromise;
    }

    /** The errors the last task hit, with how often each came back. */
    turnErrors(): { signature: string; tool: string; count: number; repeats: number }[] {
        return [...this.errorsThisTurn].map(([signature, e]) => ({ signature, tool: e.tool, count: e.count, repeats: Math.max(0, e.count - 1) }));
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
        clearInterval(this.readyWatch);
        this.local?.processes.killAll();
    }

    private async execute(cwd: string, prompt: string, plan: TurnPlan): Promise<void> {
        const turn: ActiveTurn = {
            id: `turn-${Date.now().toString(36)}-${++this.turnCount}`,
            askedForScript: /\b(?:python|script|\.py\b|python-pptx|code\s+(?:to|that)\s+(?:makes?|generates?|builds?))\b/i.test(prompt),
            startedAt: Date.now(),
            tokensAtStart: 0,
            files: new Map(),
            runs: [],
            playbooks: plan.playbooks,
            release: plan.release,
            rate: plan.rate,
            stopRequested: false,
            deep: plan.tier === 'deep',
            checks: plan.checks ?? [],
            seq: 0,
            lastEditSeq: 0,
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
            test: plan.test || undefined,
        });
        if (plan.capacity) {
            this.options.post({ type: 'capacity', turnId: turn.id, ...plan.capacity });
        }
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
            // Running a project is a short job: if it has not worked by then, the user should hear why instead of waiting.
            // Start counts carry over "Continue": only a new request starts them again.
            if (plan.fresh) {
                local.processes.newTask();
            }
            const limit = this.options.taskTokenLimit();
            agent.maxTurnTokens = limit > 0 && plan.playbooks.some((p) => p.id === 'run') ? Math.min(limit, 150_000) : limit;
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

            let compacted = false;
            for (let attempt = 0, first = true; ; first = false) {
                const outcome = await this.runAgent(agent, input, turn.id, first ? images : undefined, {
                    fresh: first && plan.fresh,
                    knownFiles: first ? plan.knownFiles : undefined,
                    tools: plan.tools,
                    // Quick tasks need little thinking; deep tasks keep each provider's own default.
                    effort: plan.tier === 'fast' ? 'low' : undefined,
                    system: plan.chat?.system,
                    history: plan.chat?.history,
                });
                steps += outcome.steps;
                reason = outcome.reason;
                if (reason === 'budget') {
                    this.options.post({
                        type: 'notice',
                        turnId: turn.id,
                        level: 'warn',
                        message: `Paused after ${compactNumber(agent.usage.inputTokens + agent.usage.outputTokens - turn.tokensAtStart)} tokens to check with you. Nothing is lost. Press Continue to carry on, or say what to do differently. (A task still making progress runs on to twice the limit before pausing; the limit is freeagentcoder.taskTokenLimit.)`,
                    });
                }
                if (reason !== 'error' || outcome.error === undefined) {
                    break;
                }
                const recoveryOn = this.options.features().autoRecovery;
                // Too big for every model: summarize the earlier conversation once and carry on.
                if (recoveryOn && !compacted && !turn.stopRequested && isContextTooLarge(outcome.error) && this.abort) {
                    compacted = true;
                    this.options.post({
                        type: 'notice',
                        turnId: turn.id,
                        level: 'info',
                        message: "The conversation grew larger than your models accept. Summarizing the earlier part and continuing…",
                    });
                    try {
                        for await (const event of agent.compact(this.abort.signal, 'forced')) {
                            this.forward(turn.id, event);
                        }
                        this.options.log({ kind: 'agent', source: 'Task', message: outcome.error, recovered: true, action: 'Summarized the conversation and resumed' });
                        input = COMPACTED_PROMPT;
                        continue;
                    } catch (error) {
                        this.options.log({ kind: 'agent', source: 'Task', message: errorMessage(error), recovered: false, action: 'Summarizing the conversation failed' });
                    }
                }
                const recovery = turn.stopRequested || !recoveryOn ? undefined : recoveryFor(outcome.error, attempt++);
                if (!recovery) {
                    this.postError(turn.id, outcome.error);
                    const retries = attempt - 1;
                    this.options.log({
                        kind: 'agent',
                        source: 'Task',
                        message: outcome.error,
                        recovered: false,
                        action: retries > 0
                            ? `Stopped after ${retries} automatic ${retries === 1 ? 'retry' : 'retries'}`
                            : recoveryOn
                              ? 'Stopped the task and explained what to do'
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
            await this.finish(turn, reason, steps);
        }
    }

    private async runAgent(
        agent: LocalAgent['agent'],
        input: string,
        turnId: string,
        images?: ImagePart[],
        turnOptions: { fresh?: boolean; knownFiles?: string[]; tools?: string[]; effort?: 'low' | 'medium' | 'high'; system?: string; history?: number } = {},
    ): Promise<{ reason: TurnEndReason; steps: number; error?: string }> {
        let reason: TurnEndReason = 'error';
        let steps = 0;
        let error: string | undefined;
        for await (const event of agent.run(input, { signal: this.abort?.signal, images, ...turnOptions })) {
            if (event.type === 'done') {
                reason = event.reason;
                steps = event.steps;
            } else if (event.type === 'error') {
                error = event.message;
            } else {
                if (event.type === 'tool_end' && event.result.isError && !event.denied) {
                    const signature = errorSignature(event.call.name, event.result.content);
                    const seen = this.errorsThisTurn.get(signature);
                    this.errorsThisTurn.set(signature, { tool: event.call.name, count: (seen?.count ?? 0) + 1 });
                }
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

    private async finish(turn: ActiveTurn, reason: TurnEndReason, steps: number): Promise<void> {
        for (const resolve of [...this.approvals.values()]) {
            resolve({ allow: false, feedback: 'The task ended before this was approved.' });
        }
        const files: ChangedFile[] = [];
        for (const [path, file] of turn.files) {
            const diff = lineDiff(file.before, file.after, 0);
            const added = diff.filter((l) => l.kind === 'add').length;
            const removed = diff.filter((l) => l.kind === 'del').length;
            if (added || removed || file.created) {
                files.push({ path, created: file.created, added, removed, diffId: file.diffId });
            }
        }

        // Everything that needs the disk is read before the turn is marked over, so a new task cannot start in between.
        const gates =
            turn.playbooks.length && (turn.runs.length || turn.files.size) && this.localRoot
                ? await gateResults(turn.playbooks, turn.runs, turn.release, this.localRoot, turn.files.keys(), turn.lastEditSeq).catch(() => undefined)
                : undefined;
        // The report on a running app, only when the task started one (installing a tool alone has no link to show).
        if (gates && turn.playbooks.some((p) => p.id === 'run') && (turn.runs.some((r) => r.background) || this.runningApps().length > 0)) {
            const app = this.runningApps().find((a) => a.address);
            const starting = !!app?.starting && !app.errors.length;
            if (starting) {
                turn.evidence = { url: app!.address!, opens: 'still starting', drawn: 'no-browser', seq: turn.lastEditSeq };
            } else if (app?.address && (!turn.evidence || turn.evidence.url !== app.address || turn.evidence.opens !== true)) {
                const opens = await httpProbe(app.address);
                turn.evidence = { url: app.address, opens, drawn: app.errors.length ? 'errors' : 'no-browser', detail: app.errors[0], seq: turn.lastEditSeq };
            }
            gates.push(...evidenceGates(turn.evidence));
            if (starting && reason !== 'aborted' && reason !== 'error') {
                this.options.post({
                    type: 'notice',
                    turnId: turn.id,
                    level: 'info',
                    message: 'The app is still starting (a first Flutter web build takes one to two minutes). A Preview button appears here as soon as it answers.',
                });
                this.watchUntilReady(turn.id);
            } else if (reason !== 'aborted' && reason !== 'error') {
                const e = turn.evidence;
                const truth = !e
                    ? 'The app is not running: no server was started that answers. The reply above is not verified.'
                    : e.opens !== true
                      ? `The app is not reachable: FreeAgentCoder opened ${e.url} and ${e.opens}. The reply above is not verified.`
                      : e.drawn === 'errors'
                        ? `The app opens at ${e.url} but shows an error: ${e.detail ?? 'see the output above'}.`
                        : undefined;
                if (truth) {
                    this.options.post({ type: 'notice', turnId: turn.id, level: 'warn', message: truth });
                }
            }
        }
        const preview = reason === 'aborted' || reason === 'error' ? undefined : await this.previewFor(turn).catch(() => undefined);
        if (reason === 'completed' && preview?.kind === 'file') {
            // The agent may finish only so many times; if it changed the page after its last check, say how it stands.
            await this.pageReview(turn, '', true).catch(() => undefined);
        }
        const missing = await this.missingFiles(turn).catch(() => []);
        if (missing.length) {
            this.options.post({
                type: 'notice',
                turnId: turn.id,
                level: 'warn',
                message: `${missing.length} of the ${turn.files.size} files this task wrote ${missing.length === 1 ? 'is' : 'are'} no longer on disk (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}). They were written, then removed: by a command the task ran, a sync tool such as OneDrive, or Undo. Check the commands above, or ask for them to be written again.`,
            });
        }
        this.turn = undefined;
        this.abort = undefined;

        if (gates) {
            this.options.post({
                type: 'checks',
                turnId: turn.id,
                playbooks: turn.playbooks.map((p) => p.name),
                gates,
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
            preview,
            // Did it do the work, or only talk about it? Changed files, a check that passed, or a server it started.
            worked: files.length > 0 || !!gates?.some((g) => g.status === 'passed') || turn.runs.some((r) => r.background),
            ...(turn.rate && reason !== 'aborted' ? { rate: true } : {}),
        });
        this.options.post({ type: 'usage', ...this.usageInfo() });
    }

    /** Files the task wrote that are gone by the time it ends. */
    private async missingFiles(turn: ActiveTurn): Promise<string[]> {
        const root = this.localRoot;
        if (!root) {
            return [];
        }
        const checks = await Promise.all(
            [...turn.files.entries()].map(async ([file, touched]) => {
                const gone = await fs.stat(path.resolve(root, file)).then(
                    () => false,
                    () => true,
                );
                // A file the task deleted on purpose ends empty.
                return gone && touched.after !== '' ? file : undefined;
            }),
        );
        return checks.filter((file): file is string => file !== undefined);
    }

    /**
     * What to show when the task ends: the address of a server it left running,
     * or a web page it wrote that opens straight from the disk.
     */
    private async previewFor(turn: ActiveTurn): Promise<PreviewView | undefined> {
        const root = this.localRoot;
        if (!root || !this.local) {
            return undefined;
        }
        // Only a link the editor has opened itself, as the server printed it for the app.
        for (const app of this.runningApps()) {
            if (app.address && !app.errors.length && (await httpProbe(app.address)) === true) {
                return { kind: 'url', target: app.address, auto: turn.runs.some((run) => run.background) };
            }
        }
        const page = await this.pageFor(turn);
        return page ? { kind: 'file', target: page.file, auto: page.created } : undefined;
    }

    /**
     * The plain web page this task worked on: an HTML file it wrote, or the
     * index.html beside the scripts and styles it changed. A page next to a
     * package.json belongs to a dev server and shows nothing on its own.
     */
    private async pageFor(turn: ActiveTurn): Promise<{ file: string; created: boolean } | undefined> {
        const root = this.localRoot;
        if (!root) {
            return undefined;
        }
        const has = (file: string) =>
            fs.stat(path.join(root, file)).then(
                (stat) => stat.isFile(),
                () => false,
            );
        const inside = [...turn.files.entries()].filter(([file]) => !path.isAbsolute(file));
        const pages = inside.filter(([file]) => /\.html?$/i.test(file)).sort(([a, fa], [b, fb]) => rank(a, fa.created) - rank(b, fb.created));
        for (const [file, touched] of pages) {
            if (!(await has(path.posix.join(path.posix.dirname(file), 'package.json')))) {
                return { file, created: touched.created };
            }
        }
        for (const [file] of inside.filter(([name]) => /\.(?:js|mjs|css)$/i.test(name))) {
            // Walk up from the script or stylesheet to the page that loads it.
            for (let dir = path.posix.dirname(file); ; dir = path.posix.dirname(dir)) {
                if (await has(path.posix.join(dir, 'package.json'))) {
                    break;
                }
                if (await has(path.posix.join(dir, 'index.html'))) {
                    return { file: path.posix.join(dir, 'index.html'), created: false };
                }
                if (dir === '.' || dir === '/') {
                    break;
                }
            }
        }
        return undefined;
    }

    /**
     * Loads the page this task worked on in a hidden browser. With errors, the
     * agent is sent back to fix them (or, at the very end, the user is told);
     * a page that loads cleanly costs nothing more.
     */
    private async pageReview(turn: ActiveTurn, reply: string, final = false): Promise<string | undefined> {
        const root = this.localRoot;
        if (!root || !this.options.checkPages() || !turn.files.size || turn.pageCheckSeq === turn.lastEditSeq || reply.trim().endsWith('?')) {
            return undefined;
        }
        const page = await this.pageFor(turn);
        if (!page) {
            return undefined;
        }
        const report = await this.options.previews.check(root, page.file, this.abort?.signal);
        if (!report || this.abort?.signal.aborted) {
            return undefined;
        }
        turn.pageCheckSeq = turn.lastEditSeq;
        const layout = !turn.layoutRaised && !final;
        const problem = pageProblem(report, layout || final);
        if (problem && layout && !report.errors.length && report.layout.length) {
            turn.layoutRaised = true;
        }
        if (!problem) {
            this.options.post({ type: 'notice', turnId: turn.id, level: 'info', message: `Checked ${page.file} in a browser: it loads with no errors.` });
            return undefined;
        }
        this.options.post({
            type: 'notice',
            turnId: turn.id,
            level: 'warn',
            message: !final
                ? `Loaded ${page.file} in a browser: ${problem}. Sending it back to be fixed.`
                : pageProblem(report)
                  ? `${page.file} still does not work in a browser (${problem}). Send "fix the errors in the page" to carry on.`
                  : `${page.file} loads, but ${problem} Send "fix the layout" if that is not intended.`,
        });
        return pageFeedback(page.file, report, layout);
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
        const turn = this.turn;
        if (ok && event.call.name === 'check_page' && turn) {
            turn.pageCheckSeq = turn.lastEditSeq;
        }
        if (ok && event.call.name === 'make_deck' && turn) {
            // A deck built from its outline is the build: it counts like running a build script.
            turn.runs.push({ command: 'make_deck', exitCode: 0, background: false, seq: ++turn.seq });
        }
        if (raw?.type === 'command' && event.call.name === 'run_command' && turn) {
            turn.runs.push({ command: raw.command, exitCode: raw.exitCode, background: !!raw.background, seq: ++turn.seq });
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
        turn.lastEditSeq = ++turn.seq;
        this.options.diffs.set(file.diffId, file.before, file.after);
        return file.diffId;
    }

    /**
     * Before the agent ends a turn: a playbook's required gates must have
     * passed, and any other complex task that changed code must have passed
     * one of the project's own checks since its last edit.
     */
    private readonly reviewCompletion = async (message: AssistantMessage): Promise<string | Verdict | undefined> => {
        const turn = this.turn;
        if (!turn) {
            return undefined;
        }
        // A run task ends with a live address, not a link nothing serves or instructions for the user.
        if (turn.playbooks.some((p) => p.id === 'run') && this.local) {
            const apps = this.runningApps();
            if (apps.length && apps.every((app) => app.starting)) {
                return {
                    feedback:
                        'The app is still starting: its output has not said where it is served yet (a first Flutter web build takes one to two minutes). Wait for it: check the process tool every 20 to 30 seconds until it prints the address, then finish in one or two lines without writing the address.',
                    notice: 'Still starting: FreeAgentCoder is waiting for the app to say it is ready.',
                };
            }
            const serving = apps.flatMap((app) => (app.address ? [app.address] : []));
            const verdict = await runProof(message.content, serving);
            if (verdict) {
                return verdict;
            }
            const seen = await this.lookAtRunningApp(turn, addressesIn(message.content)[0] ?? serving[0], apps.flatMap((app) => app.errors));
            if (seen) {
                return seen;
            }
        }
        let feedback: string | undefined;
        if (turn.playbooks.length) {
            feedback =
                (turn.files.size || turn.runs.length || turn.playbooks.some((p) => p.id === 'test')) && this.localRoot
                    ? await completionReview(turn.playbooks, turn.runs, turn.release, this.localRoot, turn.files.keys(), message.content, turn.lastEditSeq)
                    : undefined;
        } else if (turn.deep && turn.checks.length && turn.files.size && codeChanged(turn.files.keys())) {
            feedback = verificationReview(turn.checks, turn.runs, turn.lastEditSeq, message.content);
        }
        // Whatever the checks say, a web page must also load: a hidden browser opens it and reports its errors.
        return feedback ?? this.pageReview(turn, message.content).catch(() => undefined);
    };

    /**
     * Opens the app's address and loads it in a hidden browser, once per change,
     * keeping what was found for the report. Errors the browser reports send the
     * agent back; a page that cannot be confirmed (a Flutter debug server waits
     * for a debugger) is reported as not confirmed, never as working.
     */
    private async lookAtRunningApp(turn: ActiveTurn, address: string | undefined, errors: string[] = []): Promise<Verdict | undefined> {
        const url = address ? addressesIn(address)[0] : undefined;
        if (url && errors.length) {
            // What the app printed is what the user sees: a red error screen is not a working app.
            turn.evidence = { url, opens: true, drawn: 'errors', detail: errors[0], seq: turn.lastEditSeq };
            return {
                feedback: [
                    `The app is served at ${url}, but it shows an error instead of the app. Its output says:`,
                    ...errors.slice(0, 3).map((e) => `- ${e}`),
                    'That is what the user sees. Find the cause in the source (read the files involved first), fix only that, and let the server reload or restart it once. Do not call it working while this error is printed.',
                ].join('\n'),
                notice: `The app opens but shows an error: ${errors[0]!.slice(0, 160)}. Still working on it.`,
            };
        }
        if (!url || (turn.evidence?.url === url && turn.evidence.seq === turn.lastEditSeq)) {
            return undefined;
        }
        const opens = await httpProbe(url);
        const evidence: RunEvidence = { url, opens, drawn: 'no-browser', seq: turn.lastEditSeq };
        turn.evidence = evidence;
        if (opens !== true) {
            return undefined;
        }
        const report = await this.options.previews.checkUrl(url, this.abort?.signal).catch(() => undefined);
        if (!report) {
            return undefined;
        }
        evidence.drawn = report.errors.length ? 'errors' : isBlank(report) ? 'unconfirmed' : 'yes';
        evidence.detail = report.errors[0];
        return report.errors.length
            ? {
                  feedback: `The page at ${url} opens, but the browser reports ${report.errors.length} error${report.errors.length === 1 ? '' : 's'}:\n${report.errors
                      .slice(0, 3)
                      .map((e) => `- ${e}`)
                      .join('\n')}\nFind the cause in the source, fix it, and check again before calling it done.`,
                  notice: `The page opens but the browser reports an error: ${report.errors[0]!.slice(0, 160)}. Still working on it.`,
              }
            : undefined;
    }

    /**
     * In a documents task, a python-pptx script is refused unless the user asked
     * for one: make_deck lays decks out with tested designs, and a hand-written
     * script was what turned a real deck back into a plain template (eight of them
     * were left in the user's folder).
     */
    private guardWrite(abs: string, content: string): string | undefined {
        const turn = this.turn;
        if (!turn || turn.askedForScript || !turn.playbooks.some((p) => p.id === 'documents')) {
            return undefined;
        }
        if (/\.py$/i.test(abs) && /^\s*(?:from\s+pptx\b|import\s+pptx\b)/m.test(content)) {
            return 'Not written: presentations are built with make_deck, never with a python-pptx script. Call make_deck with the outline; if it listed problems, fix those fields and call it again (it also accepts gallery, cards and steps written as items or points).';
        }
        return undefined;
    }

    /** The apps this session left running: the address each printed for the app (never its debug service) and the errors it printed. */
    private runningApps(): { address?: string; errors: string[]; starting: boolean }[] {
        return (this.local?.processes.list() ?? [])
            .filter((proc) => !proc.exited)
            .map((proc) => {
                const output = proc.output.replace(ANSI, '');
                return { address: appAddress(output, proc.command), errors: appErrors(output), starting: stillStarting(output, proc.command) };
            });
    }

    /**
     * After a task ends with its app still starting: watch it for a few minutes,
     * and once it says where it is served and the link answers, put the Preview
     * button on that task. Stops if the app stops or prints an error.
     */
    private watchUntilReady(turnId: string): void {
        clearInterval(this.readyWatch);
        const until = Date.now() + 6 * 60_000;
        let checking = false;
        this.readyWatch = setInterval(() => {
            if (checking) {
                return;
            }
            checking = true;
            void (async () => {
                const apps = this.runningApps();
                const app = apps.find((a) => a.address);
                if (!apps.length || Date.now() > until) {
                    clearInterval(this.readyWatch);
                    if (!apps.length) {
                        this.options.post({ type: 'notice', turnId, level: 'warn', message: 'The app stopped before it was ready. Ask again to see what went wrong.' });
                    }
                } else if (app?.errors.length) {
                    clearInterval(this.readyWatch);
                    this.options.post({ type: 'notice', turnId, level: 'warn', message: `The app started but shows an error: ${app.errors[0]!.slice(0, 200)}` });
                } else if (app?.address && !app.starting && (await httpProbe(app.address)) === true) {
                    clearInterval(this.readyWatch);
                    this.options.post({ type: 'previewReady', turnId, preview: { kind: 'url', target: app.address, auto: false } });
                }
            })().finally(() => {
                checking = false;
            });
        }, 3_000);
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
                extraInstructions: await (async () => {
                    const snapshot = await projectSnapshot(cwd);
                    return [editorInstructions({ python: /\bPython\b|Jupyter/.test(snapshot) }), snapshot].filter(Boolean).join('\n\n');
                })(),
                maxSteps: MAX_STEPS,
                extraTools: [checkPageTool(this.options.previews), getProblemsTool(), documentCheckTool(this.options.reviewDocument), makeDeckTool(this.options.reviewDocument)],
                guardWrite: (abs, content) => this.guardWrite(abs, content),
                afterEdit: editorProblemsAfterEdit(cwd, () => vscode.workspace.getConfiguration('freeagentcoder').get<boolean>('editorErrorsAfterEdit', true)),
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
        const explained = explainError(message);
        this.options.post({ type: 'error', turnId, message: explained.title, hint: explained.hint, action: explained.action, details: message });
    }
}

/** Which page to show first: a new index.html nearest the top of the project. */
function rank(file: string, created: boolean): number {
    return (created ? 0 : 100) + (/(^|\/)index\.html?$/i.test(file) ? 0 : 10) + file.split('/').length;
}
