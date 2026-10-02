import { promises as fs } from 'node:fs';
import * as path from 'node:path';
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
import type { ApprovalView, AttachmentView, ChangedFile, PermissionMode, PreviewView, Tier, ToolDisplayView, ToWebview, TurnEndReason } from '../shared/protocol';
import type { DiffDocuments } from './diffDocuments';
import { editorProblemsAfterEdit, getProblemsTool } from './editorProblems';
import { editorInstructions } from './instructions';
import { completionReview, gateResults } from './gates';
import type { Playbook } from './playbooks';
import type { ProjectCheck } from './projectChecks';
import { checkPageTool, pageFeedback, pageProblem, type PagePreviews } from '../preview/pages';
import { projectSnapshot } from './projectSnapshot';
import { explainError, isContextTooLarge, recoveryFor } from './recovery';
import { codeChanged, verificationReview, type SequencedRun } from './testing';

type ToolEndEvent = Extract<AgentEvent, { type: 'tool_end' }>;
type RawDisplay = NonNullable<ToolEndEvent['result']['display']>;

const MAX_STEPS = 150;
/**
 * A quick task's tools: reading, searching, editing and one command. Leaving the
 * rest out saves about a thousand tokens on every step; the deep tier has all.
 */
export const QUICK_TOOLS = ['read_file', 'edit_file', 'write_file', 'list_dir', 'glob', 'grep', 'search_code', 'run_command'];
const DIFF_LINES = 400;
const OUTPUT_CHARS = 8_000;
const RESUME_PROMPT = 'Continue the task from where you stopped. (The editor resumed it automatically after a temporary problem reaching the AI providers.)';
/** A local address in what a dev server printed. */
const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+[^\s"'<>)\]]*/i;
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
    /** Tokens one task may use before it pauses for the user to continue. 0: no limit. */
    taskTokenLimit(): number;
    /** Serves and checks web pages in the open folder. */
    previews: PagePreviews;
    /** Whether a web page is loaded in a hidden browser before the agent may call it done. */
    checkPages(): boolean;
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
            agent.maxTurnTokens = this.options.taskTokenLimit();
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
                    tools: plan.tier === 'fast' ? QUICK_TOOLS : undefined,
                    // Quick tasks need little thinking; deep tasks keep each provider's own default.
                    effort: plan.tier === 'fast' ? 'low' : undefined,
                });
                steps += outcome.steps;
                reason = outcome.reason;
                if (reason === 'budget') {
                    this.options.post({
                        type: 'notice',
                        turnId: turn.id,
                        level: 'warn',
                        message: `Paused: this task has used ${compactNumber(agent.usage.inputTokens + agent.usage.outputTokens - turn.tokensAtStart)} tokens, the most one task may use before asking you. Nothing is lost. Press Continue to carry on, or change the limit in Settings (freeagentcoder.taskTokenLimit).`,
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
        turnOptions: { fresh?: boolean; tools?: string[]; effort?: 'low' | 'medium' | 'high' } = {},
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
                ? await gateResults(turn.playbooks, turn.runs, turn.release, this.localRoot, turn.files.keys()).catch(() => undefined)
                : undefined;
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
        for (const proc of this.local.processes.list()) {
            const url = proc.exited ? undefined : LOCAL_URL.exec(proc.output.replace(ANSI, ''))?.[0];
            if (url) {
                return { kind: 'url', target: url.replace('[::1]', 'localhost'), auto: turn.runs.some((run) => run.background) };
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
    private readonly reviewCompletion = async (message: AssistantMessage): Promise<string | undefined> => {
        const turn = this.turn;
        if (!turn) {
            return undefined;
        }
        let feedback: string | undefined;
        if (turn.playbooks.length) {
            feedback =
                (turn.files.size || turn.runs.length || turn.playbooks.some((p) => p.id === 'test')) && this.localRoot
                    ? await completionReview(turn.playbooks, turn.runs, turn.release, this.localRoot, turn.files.keys(), message.content)
                    : undefined;
        } else if (turn.deep && turn.checks.length && turn.files.size && codeChanged(turn.files.keys())) {
            feedback = verificationReview(turn.checks, turn.runs, turn.lastEditSeq, message.content);
        }
        // Whatever the checks say, a web page must also load: a hidden browser opens it and reports its errors.
        return feedback ?? this.pageReview(turn, message.content).catch(() => undefined);
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
                extraInstructions: await (async () => {
                    const snapshot = await projectSnapshot(cwd);
                    return [editorInstructions({ python: /\bPython\b|Jupyter/.test(snapshot) }), snapshot].filter(Boolean).join('\n\n');
                })(),
                maxSteps: MAX_STEPS,
                extraTools: [checkPageTool(this.options.previews), getProblemsTool()],
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
