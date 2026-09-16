import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ModelRouter, PRESETS, tokenize, type SearchHit } from '@agentic/core';
import { configPath, isGitRepo, loadConfig, loadProjectInstructions, type AgenticConfig } from '@agentic/core/node';
import { classifyTask, isFollowUp, isValidModelChoice, KEY_PROVIDERS, parseModelChoice, planRoute, providerLabel, providerViews } from './agent/catalog';
import { ChainBuilder, isAuthFailure, verifyKey, type CallResult, type RoutableKey } from './agent/chain';
import { correctionBrief, isCorrection, learnPrompt, LEARN_SYSTEM, parseLessons, rememberCommand } from './agent/correction';
import { DIFF_SCHEME, DiffDocuments } from './agent/diffDocuments';
import { buildBrief, choosePlaybooks, releaseIntent } from './agent/playbooks';
import { detectStack } from './agent/projectSnapshot';
import { AgentSession, type SessionLogEntry, type TurnPlan } from './agent/session';
import { PDF_READER_MODEL, planVisionRoute } from './agent/visionRoute';
import { attachmentViews, prepareAttachments, type AttachmentReaders } from './attachments/prepare';
import { complete, describeImages, digestDocument, readPdfWithGemini } from './attachments/reader';
import { HistoryStore, newChatId } from './history/historyStore';
import { KeyStore } from './keys/keyStore';
import { parseQuotaHeaders } from './keys/quota';
import { ErrorLog, redact } from './logs/errorLog';
import { lessonsBlock, MemoryStore, type Lesson } from './memory/memoryStore';
import { featureViews, isFeatureId, loadFeatures, saveFeatures, type Features } from './settings/features';
import { compactNumber, errorMessage, formatDuration } from './shared/format';
import {
    AUTO_MODEL,
    type AttachmentInput,
    type FromWebview,
    type HistoryMode,
    type KeySource,
    type KeyStatus,
    type KeyView,
    type LessonView,
    type OverviewView,
    type PermissionMode,
    type ProjectStatus,
    type PromptsLeft,
    type RouteView,
    type SettingsView,
    type Tier,
    type ToWebview,
} from './shared/protocol';
import { adviseKeys, estimatePromptsLeft, providerCapacity } from './usage/advisor';
import { UsageStore } from './usage/usageStore';

const MODE_KEY = 'freeagentcoder.mode';
const MODEL_KEY = 'freeagentcoder.model';
const HISTORY_KEY = 'freeagentcoder.historyMode';
const DISABLED_EXTERNAL_KEY = 'freeagentcoder.disabledExternalKeys';
const TRANSCRIPT_LIMIT = 20_000;
const ATTACHMENT_KINDS = new Set(['image', 'document', 'text']);
const TRANSCRIPT_TYPES = new Set<ToWebview['type']>([
    'turnStart',
    'model',
    'text',
    'reasoning',
    'resetText',
    'assistant',
    'preparing',
    'toolStart',
    'toolOutput',
    'toolEnd',
    'approval',
    'approvalResolved',
    'todos',
    'notice',
    'error',
    'turnEnd',
    'undone',
    'checks',
    'learned',
]);

interface ExternalKey extends RoutableKey {
    source: Exclude<KeySource, 'extension'>;
    sourceDetail: string;
}

interface KeyInfo {
    id: string;
    provider: string;
    label: string;
    last4: string;
    source: KeySource;
    sourceDetail?: string;
    createdAt?: number;
    verifiedAt?: number;
    enabled: boolean;
    invalidReason?: string;
}

export interface ViewSink {
    post(message: ToWebview): void;
}

function titleOf(prompt: string): string {
    const text = prompt.replace(/\s+/g, ' ').trim();
    return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

function lessonView(lesson: Lesson): LessonView {
    return { id: lesson.id, text: lesson.text, scope: lesson.scope, source: lesson.source, createdAt: lesson.createdAt, project: lesson.project };
}

/** Attachments come from the webview: keep only well-formed ones. */
function sanitizeAttachments(value: unknown): AttachmentInput[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter(
        (a): a is AttachmentInput =>
            !!a && typeof a === 'object' && ATTACHMENT_KINDS.has((a as AttachmentInput).kind) && typeof (a as AttachmentInput).data === 'string' && typeof (a as AttachmentInput).name === 'string',
    );
}

/** Gemini names its daily limit in rate-limit errors ("…PerDay… limit: 250"), though it sends no quota headers. */
function dailyLimitFrom(message: string): number | undefined {
    if (!/per ?day|perday|daily/i.test(message)) {
        return undefined;
    }
    const match = /\blimit:\s*(\d{1,7})\b/i.exec(message);
    return match ? Number(match[1]) : undefined;
}

/** The extension-side brain: keys, usage, routing, attachments, memory, history, logs, and the chat session. */
export class Controller implements vscode.Disposable {
    private readonly keys: KeyStore;
    private readonly usage: UsageStore;
    private readonly history: HistoryStore;
    private readonly errorLog: ErrorLog;
    private readonly memory: MemoryStore;
    private readonly diffs = new DiffDocuments();
    private readonly router = new ModelRouter([]);
    private readonly chain: ChainBuilder;
    private readonly session: AgentSession;
    private readonly disposables: vscode.Disposable[] = [];
    private sink?: ViewSink;
    private transcript: ToWebview[] = [];
    private mode: PermissionMode;
    private model: string;
    private historyMode: HistoryMode;
    private features: Features;
    private chatId = newChatId();
    private chatCreatedAt = Date.now();
    private turnRequests = 0;
    private consentShown = false;
    private learning?: { prompt: string; evidence: string };
    private projectCache?: { root: string; at: number; stack: string[]; instructionsFile?: string; git: boolean };
    private settingsTimer?: ReturnType<typeof setTimeout>;
    private logsTimer?: ReturnType<typeof setTimeout>;
    private weakModelWarnedTurn?: string;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.keys = new KeyStore(context);
        this.usage = new UsageStore(context);
        this.history = new HistoryStore(context.globalStorageUri);
        this.errorLog = new ErrorLog(context);
        this.memory = new MemoryStore(context.globalState);
        this.features = loadFeatures(context.globalState);

        const savedMode = context.globalState.get<string>(MODE_KEY);
        this.mode = savedMode === 'ask' || savedMode === 'auto-edit' || savedMode === 'auto' ? savedMode : 'auto-edit';
        const savedModel = context.globalState.get<string>(MODEL_KEY);
        this.model = isValidModelChoice(savedModel) ? savedModel : AUTO_MODEL;
        const savedHistory = context.globalState.get<string>(HISTORY_KEY);
        this.historyMode = savedHistory === 'on' || savedHistory === 'off' ? savedHistory : 'ask';

        this.chain = new ChainBuilder({
            onAttempt: (key, model) => this.onAttempt(key, model),
            onResult: (key, result) => this.onCallResult(key, result),
            onHeaders: (key, headers) => this.usage.recordQuota(key.id, parseQuotaHeaders(headers)),
        });
        this.session = new AgentSession({
            router: this.router,
            diffs: this.diffs,
            post: (message) => this.post(message),
            mode: () => this.mode,
            log: (entry) => this.logTask(entry),
            features: () => this.features,
        });

        this.disposables.push(
            this.keys,
            this.usage,
            this.errorLog,
            this.memory,
            this.session,
            vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, this.diffs),
            this.keys.onDidChange(() => this.scheduleSettings()),
            this.usage.onDidChange(() => this.scheduleSettings()),
            this.memory.onDidChange(() => this.scheduleSettings()),
            this.errorLog.onDidChange(() => this.scheduleLogs()),
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this.session.resetWorkspace();
                this.projectCache = undefined;
                this.scheduleSettings(true);
            }),
        );
    }

    async init(): Promise<void> {
        await this.keys.migrateLegacy(KEY_PROVIDERS);
    }

    attach(sink: ViewSink): void {
        this.sink = sink;
    }

    async handle(message: FromWebview): Promise<void> {
        try {
            await this.dispatch(message);
        } catch (error) {
            this.errorLog.add({ kind: 'extension', source: `Action: ${message.type}`, message: errorMessage(error), recovered: false, action: 'Shown to you' });
            this.post({ type: 'toast', level: 'error', message: errorMessage(error) });
        }
    }

    dispose(): void {
        clearTimeout(this.settingsTimer);
        clearTimeout(this.logsTimer);
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }

    private async dispatch(message: FromWebview): Promise<void> {
        switch (message.type) {
            case 'ready': {
                // Snapshot synchronously so live events can't be replayed twice.
                const replay = [...this.transcript];
                for (const event of replay) {
                    this.sink?.post(event);
                }
                this.sink?.post({
                    type: 'state',
                    settings: await this.buildSettings(),
                    running: this.session.running,
                    hasWorkspace: !!vscode.workspace.workspaceFolders?.length,
                });
                this.sink?.post({ type: 'usage', ...this.session.usageInfo() });
                await this.postHistory();
                this.postLogs();
                return;
            }
            case 'send':
                return this.send(String(message.text ?? ''), sanitizeAttachments(message.attachments), message.correction === true);
            case 'continue':
                return this.send('Continue where you left off.', [], false);
            case 'stop':
                this.session.stop();
                return;
            case 'newChat':
                if (this.session.running) {
                    this.session.stop();
                }
                await this.saveChat();
                await this.session.newChat();
                this.transcript = [];
                this.learning = undefined;
                this.chatId = newChatId();
                this.chatCreatedAt = Date.now();
                this.post({ type: 'reset' });
                this.post({ type: 'usage', ...this.session.usageInfo() });
                await this.postHistory();
                return;
            case 'approve':
                this.session.resolveApproval(
                    message.id,
                    message.allow ? { allow: true, remember: !!message.remember } : { allow: false, feedback: message.feedback?.trim() || undefined },
                );
                return;
            case 'setMode':
                if (message.mode !== 'ask' && message.mode !== 'auto-edit' && message.mode !== 'auto') {
                    return;
                }
                this.mode = message.mode;
                this.session.setMode(message.mode);
                await this.context.globalState.update(MODE_KEY, message.mode);
                this.scheduleSettings(true);
                return;
            case 'setModel':
                if (!isValidModelChoice(message.model)) {
                    return;
                }
                this.model = message.model;
                await this.context.globalState.update(MODEL_KEY, message.model);
                this.scheduleSettings(true);
                return;
            case 'setFeature':
                if (!isFeatureId(message.id)) {
                    return;
                }
                this.features = { ...this.features, [message.id]: message.on === true };
                await saveFeatures(this.context.globalState, this.features);
                this.scheduleSettings(true);
                return;
            case 'addLesson': {
                const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                const saved = this.memory.add({ text: redact(String(message.text ?? '')), scope: message.scope === 'global' ? 'global' : 'project', source: 'user', root });
                if (!saved) {
                    this.toast('Write the lesson in a few words or more.', 'error');
                } else {
                    this.toast(saved.added ? 'Saved to memory.' : 'Updated a similar lesson you already had.', 'info');
                }
                return;
            }
            case 'deleteLesson':
                if (this.memory.remove(String(message.id))) {
                    this.toast('Lesson deleted. It will no longer be used.', 'info');
                }
                return;
            case 'addKey':
                return this.addKey(message);
            case 'renameKey':
                if (!this.keys.get(message.id)) {
                    this.toast('Keys from environment variables or the Agentic CLI config keep their source name.', 'error');
                    return;
                }
                await this.keys.update(message.id, { label: message.label });
                return;
            case 'toggleKey':
                return this.toggleKey(message.id, message.enabled);
            case 'removeKey':
                return this.removeKey(message.id);
            case 'testKey':
                return this.testKey(message.id);
            case 'openFile':
                return this.openFile(message.path, message.line);
            case 'openDiff':
                if (!(await this.diffs.open(message.diffId, message.title))) {
                    this.toast('That diff is no longer available.', 'error');
                }
                return;
            case 'openExternal':
                if (/^https?:\/\//i.test(message.url)) {
                    await vscode.env.openExternal(vscode.Uri.parse(message.url));
                }
                return;
            case 'copy':
                await vscode.env.clipboard.writeText(message.text);
                return;
            case 'pasteClipboard': {
                // Only ever in response to the Paste button in the add-key form.
                const text = await vscode.env.clipboard.readText();
                this.sink?.post({ type: 'clipboard', text: text.trim().slice(0, 400) });
                return;
            }
            case 'undo':
                return this.session.undo(message.turnId);
            case 'openFolder':
                await vscode.commands.executeCommand('vscode.openFolder');
                return;
            case 'openChat':
                return this.openChat(message.id);
            case 'deleteChat':
                await this.history.delete(message.id);
                if (message.id === this.chatId) {
                    this.chatId = newChatId();
                    this.chatCreatedAt = Date.now();
                }
                await this.postHistory();
                return;
            case 'clearHistory':
                return this.clearHistory();
            case 'setHistoryMode':
                return this.setHistoryMode(message.mode);
            case 'clearLogs':
                this.errorLog.clear();
                this.toast('Log cleared.', 'info');
                return;
            case 'copyDiagnostics':
                return this.copyDiagnostics();
            case 'logError':
                this.errorLog.add({ kind: 'extension', source: 'Chat panel', message: String(message.message).slice(0, 400), recovered: false, action: 'Reported by the chat panel' });
                return;
        }
    }

    private async send(text: string, attachments: AttachmentInput[], explicitCorrection: boolean): Promise<void> {
        const prompt = text.trim() || (attachments.length ? `Take a look at the attached file${attachments.length === 1 ? '' : 's'}.` : '');
        if (!prompt) {
            return;
        }
        if (this.session.running) {
            this.toast('FreeAgentCoder is still working. Stop the current task or wait for it to finish.', 'error');
            return;
        }
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            this.post({
                type: 'error',
                message: 'Open a folder to start.',
                hint: 'FreeAgentCoder works inside a project folder so it can read, create and run files there.',
                action: 'openFolder',
            });
            return;
        }
        const cwd = folder.uri.fsPath;

        const remember = attachments.length ? undefined : rememberCommand(prompt);
        if (remember) {
            const saved = this.memory.add({ text: redact(remember.text), scope: remember.scope, source: 'user', root: cwd });
            this.toast(
                saved ? `Saved to memory for ${saved.lesson.scope === 'global' ? 'all projects' : 'this project'}: "${saved.lesson.text}"` : 'That is too short to save as a lesson.',
                saved ? 'info' : 'error',
            );
            return;
        }

        const keys = await this.routableKeys();
        if (!keys.length) {
            this.post({
                type: 'error',
                message: 'Add an API key to get started.',
                hint: 'Free keys from Gemini, Groq or Cerebras take about a minute to create. Open Settings → API Keys.',
                action: 'openKeys',
            });
            return;
        }

        const correction = explicitCorrection || isCorrection(prompt, this.session.hasHistory, attachments.length > 0);
        const selected = parseModelChoice(this.model);
        const { tier, reason } = selected
            ? { tier: 'deep' as Tier, reason: `Selected model: ${providerLabel(selected.provider)} · ${selected.model}` }
            : correction
              ? { tier: 'deep' as Tier, reason: 'Correcting earlier work: handled point by point' }
              : attachments.length
                ? { tier: 'deep' as Tier, reason: 'Request with attachments' }
                : classifyTask(prompt, this.session.lastTier);
        const load = (id: string) => this.usage.today(id).requests;
        const route = planRoute(keys, this.model, tier, load);
        if (selected && route.steps[0]?.provider !== selected.provider) {
            this.post({
                type: 'error',
                message: `No active key for ${providerLabel(selected.provider)}.`,
                hint: 'Add a key for it in Settings → API Keys, or switch the model to Auto.',
                action: 'openKeys',
            });
            return;
        }
        const entries = this.chain.build(route.steps);
        if (!entries.length) {
            this.post({
                type: 'error',
                message: 'None of your keys can be used right now.',
                hint: 'Check key status in Settings → API Keys.',
                action: 'openKeys',
            });
            return;
        }
        this.router.replaceChain(entries);

        const followUp = isFollowUp(prompt);
        const carryChecks = followUp || correction;
        const senior = this.features.seniorMode;
        const playbooks = !senior ? [] : carryChecks ? this.session.lastPlaybooks : choosePlaybooks(prompt, tier, new Set(await readdir(cwd).catch(() => [] as string[])));
        const release = senior && (carryChecks ? this.session.lastRelease : releaseIntent(prompt));
        const notes = route.note ? [route.note] : [];
        let agentPrompt = correction ? correctionBrief(prompt) : playbooks.length && !followUp ? buildBrief(playbooks, release, prompt) : prompt;

        const lessons = followUp ? [] : this.memory.forPrompt(cwd, prompt);
        if (lessons.length) {
            agentPrompt += `\n\n${lessonsBlock(lessons)}`;
        }

        if (this.features.codeSearch && tier === 'deep' && !followUp) {
            const hits = await this.relevantFiles(cwd, prompt);
            if (hits.length) {
                agentPrompt += `\n\n## Likely relevant files\nFound by a local search of this project for the words in the request. Read them before changing anything; not all of them may matter.\n${hits
                    .map((hit) => `- ${hit.path}:${hit.start}-${hit.end} (${hit.matched.join(', ')})`)
                    .join('\n')}`;
                notes.push(
                    `Attached ${hits.length} likely relevant file${hits.length === 1 ? '' : 's'} from a local code search: ${hits
                        .slice(0, 3)
                        .map((hit) => hit.path)
                        .join(', ')}${hits.length > 3 ? '…' : ''}`,
                );
            }
        }

        this.learning = correction && this.features.learning ? { prompt, evidence: '' } : undefined;

        let prepare: TurnPlan['prepare'];
        if (attachments.length) {
            const base = agentPrompt;
            const readers: AttachmentReaders = this.features.readAttachments ? this.attachmentReaders(keys, prompt) : {};
            const hasImages = attachments.some((a) => a.kind === 'image');
            if (hasImages && !this.features.readAttachments) {
                notes.push('Reading attachments with a vision model is off, so screenshots go only to models that can see images. Turn it on in Settings → Overview.');
            } else if (hasImages && !readers.images) {
                notes.push(
                    'None of your active keys has a model that reads images (Gemini, Mistral, OpenAI or Anthropic), so text-only models will only see the file names. Add a free Gemini key for the best results.',
                );
            }
            const learning = this.learning;
            prepare = async (turnId, signal) => {
                const progress = (message: string) => this.post({ type: 'notice', turnId, level: 'info', message });
                const prepared = await prepareAttachments(attachments, { cwd, signal, readers, progress });
                for (const note of prepared.notes) {
                    this.post({ type: 'notice', turnId, level: 'warn', message: note });
                }
                if (learning) {
                    learning.evidence = prepared.evidence;
                }
                return { agentPrompt: prepared.block ? `${base}\n\n${prepared.block}` : base, images: prepared.images };
            };
        }

        await this.session.run(cwd, prompt, {
            tier,
            tierReason: reason,
            pinned: !!selected,
            notes,
            agentPrompt,
            playbooks,
            release,
            correction,
            attachments: attachmentViews(attachments),
            lessons: lessons.length,
            prepare,
        });
    }

    /** The reader models for a task's attachments, built from the keys that can serve each job. */
    private attachmentReaders(keys: RoutableKey[], request: string): AttachmentReaders {
        const load = (id: string) => this.usage.today(id).requests;
        const readers: AttachmentReaders = {};

        const vision = this.chain.build(planVisionRoute(keys, load));
        if (vision.length) {
            const router = new ModelRouter(vision);
            readers.images = (images, signal) => describeImages(router, images, request, signal);
        }

        const gemini = keys.filter((k) => k.provider === 'gemini').sort((a, b) => load(a.id) - load(b.id));
        if (gemini.length) {
            readers.scannedPdf = async (bytes, name, signal) => {
                let lastError: unknown;
                for (const key of gemini) {
                    try {
                        const result = await readPdfWithGemini({ apiKey: key.secret, model: PDF_READER_MODEL, bytes, name, request, signal });
                        this.usage.record(key.id, { ok: true, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
                        return result;
                    } catch (error) {
                        if (signal.aborted) {
                            throw error;
                        }
                        this.usage.record(key.id, { ok: false, inputTokens: 0, outputTokens: 0 });
                        this.errorLog.add({ kind: 'provider', source: `Gemini · ${key.label}`, message: errorMessage(error), recovered: true, action: 'Tried the next Gemini key for the PDF' });
                        lastError = error;
                    }
                }
                throw lastError;
            };
        }

        const deep = this.chain.build(planRoute(keys, AUTO_MODEL, 'deep', load).steps);
        if (deep.length) {
            const router = new ModelRouter(deep);
            readers.digest = (name, text, signal) => digestDocument(router, name, text, request, signal);
        }
        return readers;
    }

    /** After a completed correction, a fast model turns it into lessons for future tasks. */
    private async learn(turnId: string, candidate: { prompt: string; evidence: string }): Promise<void> {
        const folder = vscode.workspace.workspaceFolders?.[0];
        const report = this.session.lastReply();
        if (!folder || !report) {
            return;
        }
        try {
            const keys = await this.routableKeys();
            const entries = this.chain.build(planRoute(keys, AUTO_MODEL, 'fast', (id) => this.usage.today(id).requests).steps);
            if (!entries.length) {
                return;
            }
            const root = folder.uri.fsPath;
            const existing = this.memory.list(root).map((l) => l.text);
            const reply = await complete(
                new ModelRouter(entries),
                LEARN_SYSTEM,
                learnPrompt({ correction: candidate.prompt, evidence: candidate.evidence, report, existing }),
                AbortSignal.timeout(60_000),
            );
            const learned = parseLessons(reply.text).flatMap((lesson) => {
                const saved = this.memory.add({ text: redact(lesson.text), scope: lesson.scope, source: 'correction', root });
                return saved?.added ? [lessonView(saved.lesson)] : [];
            });
            if (learned.length && this.transcript.some((m) => m.type === 'turnStart' && m.turnId === turnId)) {
                this.post({ type: 'learned', turnId, lessons: learned });
                if (this.historyMode === 'on') {
                    await this.saveChat();
                }
            }
        } catch (error) {
            this.errorLog.add({ kind: 'agent', source: 'Learning', message: errorMessage(error), recovered: true, action: 'Skipped saving a lesson from this correction' });
        }
    }

    private async relevantFiles(cwd: string, prompt: string): Promise<SearchHit[]> {
        const terms = new Set(tokenize(prompt)).size;
        if (!terms) {
            return [];
        }
        try {
            const hits = await this.session.relevantFiles(cwd, prompt, 8);
            return hits.filter((hit) => hit.matched.length >= Math.min(2, terms)).slice(0, 6);
        } catch (error) {
            this.errorLog.add({ kind: 'extension', source: 'Code search', message: errorMessage(error), recovered: true, action: 'Continued without attaching files' });
            return [];
        }
    }

    private onAttempt(key: RoutableKey, model: string): void {
        const turnId = this.session.turnId;
        if (!turnId) {
            return;
        }
        this.post({ type: 'model', turnId, providerLabel: providerLabel(key.provider), model, keyLabel: key.label });
        if (model === 'openrouter/free' && this.session.lastTier === 'deep') {
            this.usage.recordWeakFallback();
            if (this.weakModelWarnedTurn !== turnId) {
                this.weakModelWarnedTurn = turnId;
                this.post({
                    type: 'notice',
                    turnId,
                    level: 'warn',
                    message:
                        "This complex task is now running on OpenRouter's free router, which picks whatever free model is available and is much weaker at large builds. See why your other keys are failing in Settings → API Keys.",
                });
            }
        }
    }

    private onCallResult(key: RoutableKey, result: CallResult): void {
        if (this.session.turnId) {
            this.turnRequests++;
        }
        this.usage.record(key.id, {
            ok: result.ok,
            inputTokens: result.usage?.inputTokens ?? 0,
            outputTokens: result.usage?.outputTokens ?? 0,
        });
        const error = result.error;
        if (!error) {
            return;
        }
        const detail = `${error.kind.replace(/_/g, ' ')}: ${error.message.replace(/^\w+:\s*/, '').slice(0, 200)}`;
        const auth = isAuthFailure(error);
        this.usage.setLastError(key.id, detail);
        this.errorLog.add({
            kind: 'provider',
            source: `${providerLabel(key.provider)} · ${key.label}`,
            message: detail,
            recovered: !auth,
            action: auth ? 'Marked the key invalid and stopped using it' : 'Handed the request to the next key or model',
        });
        if (error.kind === 'rate_limit') {
            this.usage.recordRateLimit(key.id);
            this.usage.setCooldown(key.id, Date.now() + (error.retryAfterMs ?? 60_000));
            const limit = dailyLimitFrom(error.message);
            if (limit) {
                this.usage.learnDailyLimit(key.id, limit);
            }
        } else if (auth) {
            const reason = error.message.replace(/^\w+:\s*/, '').slice(0, 160);
            if (this.keys.get(key.id)) {
                void this.keys.update(key.id, { invalidReason: reason });
            } else {
                this.usage.setInvalid(key.id, reason);
            }
        }
    }

    private logTask(entry: SessionLogEntry): void {
        this.errorLog.add(entry);
        if (entry.recovered) {
            this.usage.recordRecovery();
        }
    }

    private async afterTurn(end: Extract<ToWebview, { type: 'turnEnd' }>): Promise<void> {
        this.usage.recordTask({ tokens: end.tokens, requests: this.turnRequests, completed: end.reason === 'completed', durationMs: end.durationMs });
        this.turnRequests = 0;
        const candidate = this.learning;
        this.learning = undefined;
        if (this.historyMode === 'on') {
            await this.saveChat();
        } else if (this.historyMode === 'ask' && !this.consentShown) {
            this.consentShown = true;
            this.sink?.post({ type: 'historyConsent' });
        }
        if (candidate && end.reason === 'completed' && this.features.learning) {
            await this.learn(end.turnId, candidate);
        }
    }

    private async saveChat(): Promise<void> {
        const first = this.transcript.find((m) => m.type === 'turnStart');
        if (this.historyMode !== 'on' || !first || first.type !== 'turnStart') {
            return;
        }
        const { messages, todos } = this.session.snapshot();
        try {
            await this.history.save({
                id: this.chatId,
                title: titleOf(first.prompt),
                workspace: vscode.workspace.workspaceFolders?.[0]?.name,
                createdAt: this.chatCreatedAt,
                updatedAt: Date.now(),
                turns: this.transcript.filter((m) => m.type === 'turnStart').length,
                messages,
                todos,
                transcript: this.transcript,
            });
            await this.postHistory();
        } catch (error) {
            this.errorLog.add({ kind: 'extension', source: 'Chat history', message: errorMessage(error), recovered: false, action: 'This chat was not saved' });
        }
    }

    private async openChat(id: string): Promise<void> {
        if (this.session.running) {
            this.toast('Stop the current task before opening another chat.', 'error');
            return;
        }
        if (id === this.chatId) {
            this.sink?.post({ type: 'focusInput' });
            return;
        }
        const record = await this.history.load(id);
        if (!record) {
            this.toast("That chat couldn't be found. It may have been deleted.", 'error');
            await this.postHistory();
            return;
        }
        await this.saveChat();
        await this.session.restore(record.messages ?? [], record.todos ?? []);
        this.chatId = record.id;
        this.chatCreatedAt = record.createdAt;
        this.transcript = record.transcript ?? [];
        this.learning = undefined;
        this.sink?.post({ type: 'reset' });
        for (const event of this.transcript) {
            this.sink?.post(event);
        }
        this.sink?.post({ type: 'usage', ...this.session.usageInfo() });
        this.sink?.post({ type: 'focusInput' });
        await this.postHistory();
        const here = vscode.workspace.workspaceFolders?.[0]?.name;
        if (record.workspace && here && record.workspace !== here) {
            this.toast(`This chat was in the "${record.workspace}" folder. Files it mentions may not exist here.`, 'info');
        }
    }

    private async clearHistory(): Promise<void> {
        const choice = await vscode.window.showWarningMessage(
            'Delete all saved chats?',
            { modal: true, detail: 'Every saved conversation is removed from this computer. The chat that is open now stays open.' },
            'Delete All',
        );
        if (choice !== 'Delete All') {
            return;
        }
        await this.history.clear();
        this.chatId = newChatId();
        this.chatCreatedAt = Date.now();
        await this.postHistory();
        this.toast('All saved chats were deleted.', 'info');
    }

    private async setHistoryMode(mode: 'on' | 'off'): Promise<void> {
        if (mode !== 'on' && mode !== 'off') {
            return;
        }
        this.historyMode = mode;
        this.consentShown = true;
        await this.context.globalState.update(HISTORY_KEY, mode);
        if (mode === 'on') {
            await this.saveChat();
        }
        await this.postHistory();
        this.toast(mode === 'on' ? 'Chats will be saved on this computer.' : "Chats won't be saved. Chats you already saved stay until you delete them.", 'info');
    }

    private async postHistory(): Promise<void> {
        this.sink?.post({ type: 'history', mode: this.historyMode, chats: await this.history.list(), currentId: this.chatId });
    }

    private postLogs(): void {
        this.sink?.post({ type: 'logs', entries: this.errorLog.list().slice(0, 150), stats: this.errorLog.stats() });
    }

    private scheduleLogs(): void {
        if (this.logsTimer) {
            return;
        }
        this.logsTimer = setTimeout(() => {
            this.logsTimer = undefined;
            this.postLogs();
        }, 1_000);
    }

    private async copyDiagnostics(): Promise<void> {
        const usable = await this.routableKeys();
        const providers = [...new Set(usable.map((k) => providerLabel(k.provider)))];
        const version = String((this.context.extension.packageJSON as { version?: string }).version ?? 'unknown');
        const off = Object.entries(this.features)
            .filter(([, on]) => !on)
            .map(([id]) => id);
        const report = this.errorLog.report([
            `FreeAgentCoder diagnostics, ${new Date().toISOString()}`,
            `Extension ${version} · VS Code ${vscode.version} · ${process.platform}`,
            `Active keys: ${usable.length} (${providers.join(', ') || 'none'}). Key values are never included.`,
            `Model: ${this.model} · Permission mode: ${this.mode} · History: ${this.historyMode}`,
            `Features turned off: ${off.join(', ') || 'none'}`,
        ]);
        await vscode.env.clipboard.writeText(report);
        this.toast('Diagnostics copied. They contain no API keys.', 'info');
    }

    private async addKey(message: Extract<FromWebview, { type: 'addKey' }>): Promise<void> {
        const reply = (ok: boolean, text: string) => this.post({ type: 'keyResult', requestId: message.requestId, ok, message: text });
        const secret = message.secret.trim();
        if (!KEY_PROVIDERS.includes(message.provider)) {
            return reply(false, 'Choose a provider.');
        }
        if (!secret) {
            return reply(false, 'Paste your API key.');
        }
        if (/\s/.test(secret)) {
            return reply(false, 'The key contains spaces or line breaks. Copy it again without extra characters.');
        }
        if (secret.length < 16) {
            return reply(false, 'That key looks too short. Make sure you copied all of it.');
        }
        const check = await verifyKey(message.provider, secret);
        if (check.state === 'invalid') {
            return reply(false, check.message);
        }
        try {
            const key = await this.keys.add(message.provider, message.label, secret, check.state === 'valid' ? Date.now() : undefined);
            reply(true, `Saved "${key.label}" on this device. ${check.message}`);
        } catch (error) {
            reply(false, errorMessage(error));
        }
    }

    private async toggleKey(id: string, enabled: boolean): Promise<void> {
        if (this.keys.get(id)) {
            await this.keys.update(id, { enabled });
            return;
        }
        const disabled = this.disabledExternal();
        if (enabled) {
            disabled.delete(id);
        } else {
            disabled.add(id);
        }
        await this.context.globalState.update(DISABLED_EXTERNAL_KEY, [...disabled]);
        this.scheduleSettings(true);
    }

    private async removeKey(id: string): Promise<void> {
        const key = this.keys.get(id);
        if (!key) {
            this.toast('This key comes from an environment variable or the Agentic CLI config. Disable it here, or remove it at its source.', 'error');
            return;
        }
        const choice = await vscode.window.showWarningMessage(
            `Remove the ${providerLabel(key.provider)} key "${key.label}" (••••${key.last4})?`,
            { modal: true, detail: 'The key is deleted from VS Code Secret Storage on this device, along with its usage history.' },
            'Remove Key',
        );
        if (choice !== 'Remove Key') {
            return;
        }
        await this.keys.remove(id);
        this.usage.forget(id);
        this.chain.forget(id);
        this.toast(`Removed "${key.label}".`, 'info');
    }

    private async testKey(id: string): Promise<void> {
        const stored = this.keys.get(id);
        const external = stored ? undefined : (await this.externalKeys()).find((k) => k.id === id);
        const provider = stored?.provider ?? external?.provider;
        const secret = stored ? await this.keys.secret(id) : external?.secret;
        if (!provider || !secret) {
            this.post({ type: 'keyTest', id, ok: false, message: 'This key could not be found. Remove it and add it again.' });
            return;
        }
        const check = await verifyKey(provider, secret);
        this.chain.forget(id);
        if (stored) {
            if (check.state === 'invalid') {
                await this.keys.update(id, { invalidReason: check.message });
            } else if (check.state === 'valid') {
                await this.keys.update(id, { invalidReason: undefined, verifiedAt: Date.now() });
            }
        } else if (check.state !== 'unknown') {
            this.usage.setInvalid(id, check.state === 'invalid' ? check.message : undefined);
        }
        this.post({ type: 'keyTest', id, ok: check.state !== 'invalid', message: check.message });
    }

    private async openFile(filePath: string, line?: number): Promise<void> {
        const folder = vscode.workspace.workspaceFolders?.[0];
        const normalized = filePath.replace(/\\/g, '/');
        const uri = path.isAbsolute(filePath) || !folder ? vscode.Uri.file(filePath) : vscode.Uri.joinPath(folder.uri, normalized);
        try {
            const position = line && line > 0 ? new vscode.Position(line - 1, 0) : undefined;
            await vscode.window.showTextDocument(uri, { preview: true, selection: position ? new vscode.Range(position, position) : undefined });
        } catch {
            this.toast(`Couldn't open ${filePath}.`, 'error');
        }
    }

    private async routableKeys(): Promise<RoutableKey[]> {
        const result: RoutableKey[] = [];
        for (const key of this.keys.list()) {
            if (!key.enabled || key.invalidReason) {
                continue;
            }
            const secret = await this.keys.secret(key.id);
            if (secret) {
                result.push({ id: key.id, provider: key.provider, label: key.label, secret });
            }
        }
        const disabled = this.disabledExternal();
        for (const key of await this.externalKeys()) {
            if (disabled.has(key.id) || this.usage.invalidReason(key.id)) {
                continue;
            }
            if (!result.some((k) => k.provider === key.provider && k.secret === key.secret)) {
                result.push(key);
            }
        }
        return result;
    }

    /** Keys the Agentic CLI would use: environment variables and ~/.agentic/config.json. */
    private async externalKeys(): Promise<ExternalKey[]> {
        let config: AgenticConfig = {};
        try {
            config = await loadConfig();
        } catch {
            // A broken CLI config is reported when the agent starts.
        }
        const found: ExternalKey[] = [];
        const add = (key: ExternalKey) => {
            if (!found.some((k) => k.provider === key.provider && k.secret === key.secret)) {
                found.push(key);
            }
        };
        for (const provider of KEY_PROVIDERS) {
            for (const name of PRESETS[provider]?.keyEnv ?? []) {
                const secret = process.env[name]?.trim();
                if (secret) {
                    add({ id: `env:${name}`, provider, label: name, secret, source: 'env', sourceDetail: `Environment variable ${name}` });
                }
            }
            const secret = config.keys?.[provider]?.trim();
            if (secret) {
                add({ id: `config:${provider}`, provider, label: 'Agentic CLI', secret, source: 'config', sourceDetail: configPath() });
            }
        }
        return found;
    }

    private disabledExternal(): Set<string> {
        return new Set(this.context.globalState.get<string[]>(DISABLED_EXTERNAL_KEY, []));
    }

    private async buildSettings(): Promise<SettingsView> {
        const now = Date.now();
        const stored = this.keys.list();
        const storedSecrets = new Set<string>();
        for (const key of stored) {
            const secret = await this.keys.secret(key.id);
            if (secret) {
                storedSecrets.add(`${key.provider}|${secret}`);
            }
        }

        const views: KeyView[] = stored.map((key) => this.keyView({ ...key, source: 'extension' }, now));
        const disabled = this.disabledExternal();
        for (const key of await this.externalKeys()) {
            if (storedSecrets.has(`${key.provider}|${key.secret}`)) {
                continue;
            }
            views.push(
                this.keyView(
                    {
                        id: key.id,
                        provider: key.provider,
                        label: key.label,
                        last4: key.secret.slice(-4),
                        source: key.source,
                        sourceDetail: key.sourceDetail,
                        enabled: !disabled.has(key.id),
                        invalidReason: this.usage.invalidReason(key.id),
                    },
                    now,
                ),
            );
        }

        const usable = views.filter((k) => k.enabled && k.status !== 'invalid');
        const capacity = providerCapacity(views, this.usage.rateLimitsToday(), now);
        const recent = this.usage.taskStats(7);
        const promptsLeft = estimatePromptsLeft({ keys: views, learnedLimits: this.usage.learnedDailyLimits(), recent, now });
        return {
            mode: this.mode,
            model: this.model,
            providers: providerViews(),
            keys: views,
            usage: { window: this.usage.window(), today: this.usage.today(), month: this.usage.month(), days: this.usage.days(7) },
            routes: this.routes(usable),
            warnings: this.warnings(views, now),
            usableKeys: usable.length,
            capacity,
            suggestions: adviseKeys({ keys: views, capacity, weakFallbacksToday: this.usage.weakFallbacksToday(), recent, promptsLeft, now }),
            overview: await this.overview(promptsLeft),
        };
    }

    private async overview(promptsLeft: PromptsLeft): Promise<OverviewView> {
        const folder = vscode.workspace.workspaceFolders?.[0];
        const stats = this.usage.taskStats(7);
        const average = (total: number) => (stats.tasks ? Math.round(total / stats.tasks) : 0);
        return {
            project: folder ? await this.projectStatus(folder) : undefined,
            promptsLeft,
            efficiency: {
                tasks: stats.tasks,
                completed: stats.completed,
                avgTokens: average(stats.tokens),
                avgRequests: average(stats.requests),
                avgDurationMs: average(stats.durationMs),
                recoveries: stats.recoveries,
            },
            features: featureViews(this.features),
            lessons: this.memory.list(folder?.uri.fsPath).map(lessonView),
        };
    }

    private async projectStatus(folder: vscode.WorkspaceFolder): Promise<ProjectStatus> {
        const root = folder.uri.fsPath;
        let cached = this.projectCache;
        if (!cached || cached.root !== root || Date.now() - cached.at > 60_000) {
            const [stack, instructions] = await Promise.all([detectStack(root), loadProjectInstructions(root).catch(() => undefined)]);
            cached = { root, at: Date.now(), stack, instructionsFile: instructions?.file ? path.basename(instructions.file) : undefined, git: isGitRepo(root) };
            this.projectCache = cached;
        }
        return { name: folder.name, stack: cached.stack, instructionsFile: cached.instructionsFile, git: cached.git, indexedFiles: this.session.indexedFiles };
    }

    private keyView(key: KeyInfo, now: number): KeyView {
        const cooldownUntil = this.usage.cooldownUntil(key.id);
        const lastUsedAt = this.usage.lastUsed(key.id);
        const status: KeyStatus = !key.enabled
            ? 'disabled'
            : key.invalidReason
              ? 'invalid'
              : cooldownUntil
                ? 'cooldown'
                : !key.verifiedAt && !lastUsedAt
                  ? 'unverified'
                  : 'active';
        return {
            id: key.id,
            provider: key.provider,
            providerLabel: providerLabel(key.provider),
            label: key.label,
            last4: key.last4,
            source: key.source,
            sourceDetail: key.sourceDetail,
            createdAt: key.createdAt,
            verifiedAt: key.verifiedAt,
            enabled: key.enabled,
            status,
            statusDetail:
                status === 'invalid' ? key.invalidReason : status === 'cooldown' && cooldownUntil ? `Ready in ${formatDuration(cooldownUntil - now)}` : undefined,
            cooldownUntil,
            lastUsedAt,
            today: this.usage.today(key.id),
            month: this.usage.month(key.id),
            window: this.usage.window(key.id),
            quota: this.usage.quota(key.id),
            lastError: this.usage.lastError(key.id)?.message,
            lastErrorAt: this.usage.lastError(key.id)?.at,
        };
    }

    private routes(usable: KeyView[]): RouteView[] {
        const load = (id: string) => this.usage.today(id).requests;
        const describe = (tier: Tier) =>
            planRoute(usable, this.model, tier, load).steps.map((s) => `${providerLabel(s.provider)} · ${s.model} — ${s.keys.map((k) => k.label).join(', ')}`);
        if (parseModelChoice(this.model)) {
            return [
                {
                    title: 'Selected model',
                    description: 'Every request starts here. Your other free keys take over if it fails or hits a limit.',
                    steps: describe('deep'),
                },
            ];
        }
        return [
            { title: 'Quick tasks', description: 'Questions, explanations and small edits', steps: describe('fast') },
            { title: 'Complex tasks', description: 'Building, debugging, corrections and multi-file changes', steps: describe('deep') },
        ];
    }

    private warnings(views: KeyView[], now: number): string[] {
        const warnings: string[] = [];
        const usable = views.filter((k) => k.enabled && k.status !== 'invalid');
        if (!views.length) {
            warnings.push('No API keys yet. Add one to start using FreeAgentCoder.');
        } else if (!usable.length) {
            warnings.push('None of your keys are active. Enable or replace a key to continue.');
        }
        for (const key of views) {
            if (!key.enabled) {
                continue;
            }
            const name = `${key.providerLabel} · ${key.label}`;
            if (key.status === 'invalid') {
                warnings.push(`${name} was rejected by the provider. Replace it or test it again.`);
            }
            if (!key.quota || now - key.quota.capturedAt > 86_400_000) {
                continue;
            }
            for (const w of key.quota.windows) {
                if (w.remaining / w.limit > 0.1 || (w.resetAt && w.resetAt <= now)) {
                    continue;
                }
                warnings.push(
                    `${name}: ${compactNumber(w.remaining)} of ${compactNumber(w.limit)} ${w.dimension}${w.period ? ` per ${w.period}` : ''} left${
                        w.resetAt ? `, resets in ${formatDuration(w.resetAt - now)}` : ''
                    }.`,
                );
            }
        }
        const selected = parseModelChoice(this.model);
        if (selected && views.length && !usable.some((k) => k.provider === selected.provider)) {
            warnings.push(`Your selected model uses ${providerLabel(selected.provider)}, but there is no active key for it.`);
        }
        return warnings;
    }

    private post(message: ToWebview): void {
        if (TRANSCRIPT_TYPES.has(message.type)) {
            this.remember(message);
        }
        this.sink?.post(message);
        if (message.type === 'turnEnd') {
            void this.afterTurn(message);
        }
    }

    private remember(message: ToWebview): void {
        const index = this.transcript.length - 1;
        const last = this.transcript[index];
        if (message.type === 'text' && last?.type === 'text' && last.turnId === message.turnId) {
            this.transcript[index] = { ...last, delta: last.delta + message.delta };
            return;
        }
        if (message.type === 'reasoning' && last?.type === 'reasoning' && last.turnId === message.turnId) {
            this.transcript[index] = { ...last, delta: last.delta + message.delta };
            return;
        }
        if (message.type === 'toolOutput' && last?.type === 'toolOutput' && last.callId === message.callId) {
            this.transcript[index] = { ...last, chunk: (last.chunk + message.chunk).slice(-20_000) };
            return;
        }
        this.transcript.push(message);
        if (this.transcript.length > TRANSCRIPT_LIMIT) {
            this.transcript.splice(0, this.transcript.length - TRANSCRIPT_LIMIT + 2_000);
        }
    }

    private toast(message: string, level: 'info' | 'error'): void {
        this.post({ type: 'toast', message, level });
    }

    private scheduleSettings(immediate = false): void {
        clearTimeout(this.settingsTimer);
        this.settingsTimer = setTimeout(
            () => {
                void this.buildSettings().then((settings) => this.sink?.post({ type: 'settings', settings }));
            },
            immediate ? 0 : 400,
        );
    }
}
