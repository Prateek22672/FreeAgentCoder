import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { LabRecorder } from './lab/recorder';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ModelRouter, PRESETS, tokenize, type SearchHit } from '@agentic/core';
import { configPath, detectShell, isGitRepo, loadConfig, loadProjectInstructions, type AgenticConfig } from '@agentic/core/node';
import { planFyx, type FyxContext, type FyxPlan } from './fyx/plan';
import { FYX_MODEL, FyxProvider } from './fyx/provider';
import { LearnedCommands } from './fyx/learned';
import { classifyTask, FYX_CHOICE, isFollowUp, isValidModelChoice, KEY_PROVIDERS, parseModelChoice, planRoute, providerLabel, providerViews } from './agent/catalog';
import { ChainBuilder, isAuthFailure, verifyKey, type CallResult, type RoutableKey } from './agent/chain';
import { correctionBrief, isCorrection, learnPrompt, LEARN_SYSTEM, parseLessons, rememberCommand } from './agent/correction';
import { DIFF_SCHEME, DiffDocuments } from './agent/diffDocuments';
import { buildBrief, choosePlaybooks, releaseIntent } from './agent/playbooks';
import { detectChecks, structureMap, type ProjectCheck } from './agent/projectChecks';
import { detectStack } from './agent/projectSnapshot';
import { structureBlock, TEST_PROMPT, testBrief, testPlaybook } from './agent/testing';
import { AgentSession, type SessionLogEntry, type TurnPlan } from './agent/session';
import { PDF_READER_MODEL, planVisionRoute } from './agent/visionRoute';
import { attachmentViews, prepareAttachments, type AttachmentReaders } from './attachments/prepare';
import { readImagesLocally } from './attachments/ocr';
import { SITE_URL, TRIAL_PROVIDER } from './shared/site';
import { showWhatsNew, tellIfOutdated } from './updates';
import { Telemetry } from './telemetry/telemetry';
import { enabledSpecialists, RemoteConfig } from './agent/remoteConfig';
import { chooseSpecialist, specialistSection } from './agent/specialists';
import { complete, describeImages, digestDocument, readPdfWithGemini } from './attachments/reader';
import { HistoryStore, newChatId } from './history/historyStore';
import { KeyStore } from './keys/keyStore';
import { parseQuotaHeaders } from './keys/quota';
import { ErrorLog, redact } from './logs/errorLog';
import { lessonsBlock, MemoryStore, type Lesson } from './memory/memoryStore';
import { featureViews, isFeatureId, loadFeatures, saveFeatures, type Features } from './settings/features';
import { compactNumber, errorMessage, formatDuration } from './shared/format';
import { AUTO_MODEL, type AttachmentInput, type FromWebview, type HealthEntry, type HealthStatus, type HealthView, type HistoryMode, type KeySource, type KeyStatus, type KeyView, type LessonView, type OverviewView, type PermissionMode, type ProjectStatus, type PromptsLeft, type RoleHealth, type RouteView, type SettingsView, type Tier, type ToWebview, type PlansView } from './shared/protocol';
import { adviseKeys, estimatePromptsLeft, providerCapacity } from './usage/advisor';
import { capacityMessage, capacityRisk, estimateSavings, isDailyLimit, requestsNeeded, type TaskShape } from './usage/forecast';
import { PagePreviews } from './preview/pages';
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

function roleStatus(entries: HealthEntry[]): RoleHealth['status'] {
    if (!entries.length) {
        return 'unconfigured';
    }
    const working = entries.filter((e) => e.status === 'healthy' || e.status === 'untested').length;
    if (!working) {
        return 'down';
    }
    return working === entries.length ? 'ok' : 'degraded';
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
    private readonly previews = new PagePreviews();
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
    /** Set while a test-lab task runs. */
    private lab?: LabRecorder;
    /** Set while Fyx is doing a task, so it is counted as Fyx's and not as a model's. */
    private fyxTurn?: { kind: string; saved: number; prompt: string; learned: boolean };
    /** The request and the commands the agent ran this turn, so Fyx can learn one-command chores. */
    private turnWatch: { prompt: string; runs: { command: string; ok: boolean }[]; edits: number; okAfterEdit?: boolean; correction?: boolean } = { prompt: '', runs: [], edits: 0 };
    private learnedCommands?: LearnedCommands;
    private consentShown = false;
    private learning?: { prompt: string; evidence: string };
    private projectCache?: { root: string; at: number; stack: string[]; instructionsFile?: string; git: boolean };
    private settingsTimer?: ReturnType<typeof setTimeout>;
    private logsTimer?: ReturnType<typeof setTimeout>;
    private weakModelWarnedTurn?: string;
    /** The last settings sent to the chat panel, for sizing tasks against today's limits. */
    private lastSettings?: SettingsView;
    /** Keys already reported as out of daily quota in the current task. */
    private readonly dailyWarned = new Set<string>();
    private checksCache?: { root: string; at: number; checks: ProjectCheck[] };
    private readonly telemetry: Telemetry;
    private readonly remoteConfig: RemoteConfig;
    /** The method chosen for the task in progress, for counting outcomes by kind of work. */
    private lastSpecialist?: string;
    /** Why the last request failed in the current task, as a short cause. */
    private lastFailure?: string;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.keys = new KeyStore(context);
        this.usage = new UsageStore(context);
        this.history = new HistoryStore(context.globalStorageUri);
        this.errorLog = new ErrorLog(context);
        this.memory = new MemoryStore(context.globalState);
        this.features = loadFeatures(context.globalState);
        this.remoteConfig = new RemoteConfig(context);
        showWhatsNew(context);
        this.remoteConfig.refresh((latest) => tellIfOutdated(context, latest));
        this.telemetry = new Telemetry(context, () => {
            const keys = this.keys.list();
            return { count: keys.length, providers: keys.map((key) => key.provider) };
        });

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
            taskTokenLimit: () => Math.max(0, vscode.workspace.getConfiguration('freeagentcoder').get<number>('taskTokenLimit', 500_000)),
            previews: this.previews,
            checkPages: () => vscode.workspace.getConfiguration('freeagentcoder').get<boolean>('checkPages', true),
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

    /**
     * The paid tier as the site describes it. Asked for only when the Plans
     * page is opened — the free tier never calls the site on its own — and
     * every field is checked before it reaches the panel.
     */
    private async sendPlans(): Promise<void> {
        try {
            const response = await fetch(`${SITE_URL}/api/plans`, { signal: AbortSignal.timeout(8_000) });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const raw = (await response.json()) as Partial<PlansView>;
            const checkoutUrl = String(raw.checkoutUrl ?? '');
            this.post({
                type: 'plans',
                plans: {
                    enabled: raw.enabled === true,
                    priceLabel: String(raw.priceLabel ?? '').slice(0, 40),
                    weeklyTokens: Math.max(0, Math.round(Number(raw.weeklyTokens) || 0)),
                    checkoutUrl: /^https:\/\/\S+$/.test(checkoutUrl) ? checkoutUrl : '',
                    note: String(raw.note ?? '').slice(0, 200),
                },
            });
        } catch {
            this.post({ type: 'plans', error: 'Could not reach the site to check plans. Your free tier is not affected.' });
        }
    }

    /** The command: what anonymous counts are, and whether to send them. */
    chooseTelemetry(): Promise<void> {
        return this.telemetry.choose();
    }

    dispose(): void {
        clearTimeout(this.settingsTimer);
        clearTimeout(this.logsTimer);
        this.previews.dispose();
        this.telemetry.dispose();
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
            case 'testProject':
                return this.send(TEST_PROMPT, [], false, { test: true });
            case 'openPlans':
                return this.sendPlans();
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
            case 'setFyx':
                await vscode.workspace.getConfiguration('freeagentcoder').update('fyx', message.enabled, vscode.ConfigurationTarget.Global);
                this.toast(message.enabled ? 'Fyx is on: everyday chores run on your machine with no tokens.' : 'Fyx is off: every request goes to the AI model.', 'info');
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
            case 'openPreview':
                return this.openPreview(message.kind, String(message.target ?? ''));
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

    private async send(text: string, attachments: AttachmentInput[], explicitCorrection: boolean, options: { test?: boolean } = {}): Promise<void> {
        const test = options.test === true;
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

        this.turnWatch = { prompt, runs: [], edits: 0 };
        const fyxPicked = this.model === FYX_CHOICE;
        let fyxHandover = false;
        if (!test && !explicitCorrection && (fyxPicked || this.fyxEnabled())) {
            const plan = attachments.length ? undefined : await this.fyxPlan(cwd, prompt);
            if (plan) {
                await this.runFyx(cwd, prompt, plan);
                return;
            }
            // Fyx was picked, but this needs an AI model: say so at the top, and carry on with Auto.
            fyxHandover = fyxPicked;
        }

        const keys = await this.routableKeys();
        if (!keys.length) {
            this.post({
                type: 'error',
                message: 'Add an API key to get started.',
                hint: 'Free keys from Gemini or Groq take about a minute to create, with no card. Open Settings → API Keys.',
                action: 'openKeys',
            });
            return;
        }

        const correction = !test && (explicitCorrection || isCorrection(prompt, this.session.hasHistory, attachments.length > 0));
        this.turnWatch.correction = correction;
        const selected = parseModelChoice(this.model);
        // The kind of work sets the method. Follow-ups and corrections keep the method they already have.
        const specialist =
            !test && !correction && !isFollowUp(prompt) && this.features.seniorMode
                ? chooseSpecialist(prompt, enabledSpecialists(this.remoteConfig.current))
                : undefined;
        const base = selected
            ? { tier: 'deep' as Tier, reason: `Selected model: ${providerLabel(selected.provider)} · ${selected.model}` }
            : test
              ? { tier: 'deep' as Tier, reason: "Test run: your project's own checks" }
              : correction
              ? { tier: 'deep' as Tier, reason: 'Correcting earlier work: handled point by point' }
              : attachments.length
                ? { tier: 'deep' as Tier, reason: 'Request with attachments' }
                : classifyTask(prompt, this.session.lastTier);
        // A short request can still be the kind of work that needs a plan and checks.
        const { tier, reason } =
            specialist && specialist.minTier === 'deep' && base.tier === 'fast' && !selected
                ? { tier: 'deep' as Tier, reason: `${specialist.name}: planned and checked` }
                : base;
        const load = (id: string) => this.usage.today(id).requests;
        // On Auto, the admin can point a kind of work at a model; it is tried first, and the rest still follow.
        const preferred = !selected && specialist ? this.remoteConfig.current[specialist.id]?.model : undefined;
        const preferredProvider = preferred ? parseModelChoice(preferred)?.provider : undefined;
        const route = planRoute(keys, preferred && keys.some((k) => k.provider === preferredProvider) ? preferred : this.model, tier, load);
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
        // The project's own checks: required after complex code changes, and the whole point of a test run.
        const checks = tier === 'deep' ? await this.projectChecks(cwd) : [];
        const firstDeep = tier === 'deep' && !followUp && !this.session.hasHistory;
        const structure = test || firstDeep ? await structureMap(cwd).catch(() => '') : '';
        const playbooks = test
            ? checks.length
                ? [testPlaybook(checks)]
                : []
            : !senior
              ? []
              : carryChecks
                ? this.session.lastPlaybooks
                : choosePlaybooks(prompt, tier, new Set(await readdir(cwd).catch(() => [] as string[])));
        const release = !test && senior && (carryChecks ? this.session.lastRelease : releaseIntent(prompt));
        const notes = route.note ? [route.note] : [];
        if (fyxHandover) {
            notes.unshift('Fyx is for basic tasks: zip, git, installing packages, running your project and file chores. This request needs an AI model, so it is going to Auto. Fyx stays selected for your next basic task.');
        }
        if (keys[0]?.provider === TRIAL_PROVIDER) {
            notes.push("Running on FreeAgentCoder's free trial: a daily allowance on our keys, sent through FreeAgentCoder's server. Add your own free Gemini or Groq key in Settings → API Keys for faster, private requests with no daily cap of ours.");
        }
        let agentPrompt = test
            ? testBrief(checks, structure)
            : correction
              ? correctionBrief(prompt)
              : playbooks.length && !followUp
                ? buildBrief(playbooks, release, prompt)
                : prompt;
        if (specialist) {
            const section = specialistSection(specialist, this.remoteConfig.current[specialist.id]?.extra);
            agentPrompt = agentPrompt.includes('</task-brief>')
                ? agentPrompt.replace('</task-brief>', `\n${section}\n</task-brief>`)
                : `<task-brief source="FreeAgentCoder">\nThe editor added this brief to set the method for this kind of task. Follow it; the user did not type it.\n\n${section}\n</task-brief>\n\n## Request\n${prompt}`;
            notes.push(`Method: ${specialist.name}`);
        }
        this.lastSpecialist = specialist?.id ?? (isFollowUp(prompt) ? this.lastSpecialist : undefined);
        if (!test && firstDeep && structure) {
            agentPrompt += `\n\n${structureBlock(structure)}`;
        }
        if (test) {
            notes.push(
                checks.length
                    ? `Running ${checks.length} check${checks.length === 1 ? '' : 's'} found in this project: ${checks.map((c) => c.label.toLowerCase()).join(', ')}.`
                    : 'No build or test commands were detected automatically, so FreeAgentCoder will look for how this project is checked.',
            );
        }

        const lessons = followUp ? [] : this.memory.forPrompt(cwd, prompt);
        if (lessons.length) {
            agentPrompt += `\n\n${lessonsBlock(lessons)}`;
        }

        // Quick tasks get the likely files too: naming them up front saves exploring for them, step by resent step.
        if (this.features.codeSearch && !followUp && !test && this.session.indexedFiles !== 0) {
            const hits = (await this.relevantFiles(cwd, prompt)).slice(0, tier === 'fast' ? 4 : 8);
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
            if (this.features.localOcr) {
                readers.localImages = this.localImageReader();
            }
            const hasImages = attachments.some((a) => a.kind === 'image');
            if (hasImages && !readers.localImages && !readers.images) {
                notes.push(
                    this.features.readAttachments
                        ? 'None of your active keys has a model that reads images, and reading them on this computer is off, so text-only models will only see the file names. Add a free Gemini key, or turn on "Read images on this computer" in Settings → Overview.'
                        : 'Reading attachments is off, so screenshots go only to models that can see images. Turn it on in Settings → Overview.',
                );
            } else if (hasImages && !readers.images) {
                notes.push(
                    "No key of yours reads images, so their text is read on this computer instead. That costs no quota, but says nothing about layout, colours or what an arrow points at — add a free Gemini key for that.",
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
                if (prepared.imageSource) {
                    this.telemetry.imageRead(prepared.imageSource === 'local' ? 'locally' : 'model');
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
            capacity: this.forecast({ tier, playbooks: playbooks.length, attachments: attachments.length, correction, test }),
            test,
            checks,
            fresh: !followUp && !correction,
        });
    }

    /**
     * The test lab: fetches the admin's test tasks, writes the chosen task's
     * files into the open folder, sends its prompts one after another, and
     * posts the numbers and the conversation back to the admin page.
     */
    /** Whether a task is running, so a command can wait in the input instead of interrupting it. */
    get busy(): boolean {
        return this.session.running;
    }

    async runLabTask(): Promise<void> {
        const token = vscode.workspace.getConfiguration('freeagentcoder').get<string>('labToken', '').trim();
        if (!token) {
            void vscode.window.showInformationMessage('Set freeagentcoder.labToken first: copy it from the Test lab page in the admin panel.');
            return;
        }
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            void vscode.window.showWarningMessage('Open an empty folder first: the test task writes its files there.');
            return;
        }
        if (this.session.running) {
            void vscode.window.showWarningMessage('Wait for the current task to finish first.');
            return;
        }
        type Task = { id: string; title: string; category: string; prompts: string[]; files: Record<string, string> };
        let tasks: Task[];
        try {
            const response = await fetch(`${SITE_URL}/api/lab/tasks`, { headers: { 'x-lab-token': token }, signal: AbortSignal.timeout(15_000) });
            const body = (await response.json()) as { tasks?: Task[]; error?: string };
            if (!response.ok || !body.tasks) {
                throw new Error(body.error ?? `HTTP ${response.status}`);
            }
            tasks = body.tasks;
        } catch (error) {
            void vscode.window.showErrorMessage(`Could not load the test tasks: ${errorMessage(error)}`);
            return;
        }
        const pick = await vscode.window.showQuickPick(
            tasks.map((t) => ({ label: t.title, description: `${t.prompts.length} prompt${t.prompts.length === 1 ? '' : 's'} · ${Object.keys(t.files).length} files`, task: t })),
            { placeHolder: 'Pick a test task to run in this folder' },
        );
        if (!pick) {
            return;
        }
        const task = pick.task;
        const root = folder.uri.fsPath;
        const existing = (await readdir(root).catch(() => [] as string[])).filter((n) => !n.startsWith('.'));
        if (existing.length) {
            const go = await vscode.window.showWarningMessage(
                `This folder is not empty (${existing.length} items). A test is fairest in an empty folder. Run it here anyway?`,
                { modal: true },
                'Run here',
            );
            if (go !== 'Run here') {
                return;
            }
        }
        for (const [file, content] of Object.entries(task.files)) {
            const target = path.join(root, file);
            if (!target.startsWith(root)) {
                continue;
            }
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, content, 'utf8');
        }
        await vscode.commands.executeCommand('freeagentcoder.open');
        const recorder = new LabRecorder();
        this.lab = recorder;
        try {
            for (const [i, prompt] of task.prompts.entries()) {
                recorder.begin(prompt, i);
                await this.send(prompt, [], false);
                recorder.finish();
            }
        } finally {
            this.lab = undefined;
        }
        try {
            const response = await fetch(`${SITE_URL}/api/lab/results`, {
                method: 'POST',
                headers: { 'x-lab-token': token, 'content-type': 'application/json' },
                body: JSON.stringify({
                    taskId: task.id,
                    title: task.title,
                    category: task.category,
                    extension: String(this.context.extension.packageJSON.version ?? ''),
                    turns: recorder.turns,
                    transcript: redact(recorder.transcript),
                }),
                signal: AbortSignal.timeout(20_000),
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            void vscode.window.showInformationMessage(`Test "${task.title}" finished and was sent to the Test lab.`);
        } catch (error) {
            void vscode.window.showErrorMessage(`The test ran but could not be sent: ${errorMessage(error)}`);
        }
    }

    private fyxEnabled(): boolean {
        return vscode.workspace.getConfiguration('freeagentcoder').get<boolean>('fyx', true);
    }

    private learned(): LearnedCommands {
        return (this.learnedCommands ??= new LearnedCommands(this.context.globalState));
    }

    /** What Fyx needs to know about the project: its folders, package manager, scripts and shell. */
    private async fyxContext(cwd: string): Promise<FyxContext> {
        const entries = await readdir(cwd, { withFileTypes: true }).catch(() => []);
        const names = new Set(entries.map((e) => e.name));
        let scripts: string[] = [];
        try {
            const pkg = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
            scripts = Object.keys(pkg.scripts ?? {});
        } catch {
            // No package.json: no scripts.
        }
        const packageManager = names.has('pnpm-lock.yaml')
            ? 'pnpm'
            : names.has('yarn.lock')
              ? 'yarn'
              : names.has('bun.lockb') || names.has('bun.lock')
                ? 'bun'
                : names.has('package.json')
                  ? 'npm'
                  : undefined;
        const config = await loadConfig().catch(() => ({}) as AgenticConfig);
        // A repository whose app lives one folder down, like homes/ or frontend/ and backend/.
        const subprojects: NonNullable<FyxContext['subprojects']> = [];
        for (const entry of entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules').slice(0, 30)) {
            try {
                const dir = path.join(cwd, entry.name);
                const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
                const inside = new Set(await readdir(dir).catch(() => [] as string[]));
                subprojects.push({
                    dir: entry.name,
                    packageManager: inside.has('pnpm-lock.yaml') ? 'pnpm' : inside.has('yarn.lock') ? 'yarn' : inside.has('bun.lockb') || inside.has('bun.lock') ? 'bun' : 'npm',
                    scripts: Object.keys(pkg.scripts ?? {}),
                });
            } catch {
                // No package.json in this folder.
            }
        }
        return {
            subprojects,
            platform: process.platform,
            shell: detectShell(config.shell).kind,
            dirs: entries.filter((e) => e.isDirectory()).map((e) => e.name),
            files: entries.filter((e) => e.isFile()).map((e) => e.name),
            packageManager,
            scripts,
            git: names.has('.git'),
        };
    }

    private async fyxPlan(cwd: string, prompt: string): Promise<FyxPlan | undefined> {
        try {
            return planFyx(prompt, await this.fyxContext(cwd)) ?? this.learned().plan(prompt);
        } catch (error) {
            this.errorLog.add({ kind: 'extension', source: 'Fyx', message: errorMessage(error), recovered: true, action: 'Handed the request to the AI agent' });
            return undefined;
        }
    }

    /** Roughly what a model spends on a task: this user's own average, or a typical small task until there is one. */
    private typicalTaskTokens(): { tokens: number; basis: string } {
        const stats = this.usage.taskStats(30);
        if (stats.tasks >= 3 && stats.tokens > 0) {
            return { tokens: Math.round(stats.tokens / stats.tasks), basis: 'your average task' };
        }
        return { tokens: 6_000, basis: 'a typical small task' };
    }

    /** Runs a chore through the agent loop with Fyx as the "model": the same cards, permissions and Stop, and no tokens. */
    private async runFyx(cwd: string, prompt: string, plan: FyxPlan): Promise<void> {
        const typical = this.typicalTaskTokens();
        const savedNote = `**Fyx** did this on your machine without an AI model: 0 tokens, about ${compactNumber(typical.tokens)} saved compared with ${typical.basis}.`;
        this.router.replaceChain([{ provider: new FyxProvider(plan, savedNote), model: FYX_MODEL, contextWindow: 1_000_000, label: 'Fyx' }]);
        this.fyxTurn = { kind: plan.kind, saved: typical.tokens, prompt, learned: plan.kind === 'learned' };
        this.introduceFyx();
        await this.session.run(cwd, prompt, {
            tier: 'fast',
            tierReason: 'Fyx: an everyday task, done on your machine with no AI model',
            pinned: false,
            notes: [`Fyx: ${plan.intro}`],
            agentPrompt: prompt,
            playbooks: [],
            release: false,
            correction: false,
            attachments: [],
            lessons: 0,
        });
    }

    /** Once, the first time Fyx does a task: what it is, and how to turn it off. */
    private introduceFyx(): void {
        const shown = 'freeagentcoder.fyx.introduced';
        if (this.context.globalState.get<boolean>(shown)) {
            return;
        }
        void this.context.globalState.update(shown, true);
        void vscode.window
            .showInformationMessage(
                'Meet Fyx. Everyday tasks like zipping a folder, git, installing packages and running scripts now run on your machine without an AI model, so they finish in seconds and use no tokens. It still asks before running anything.',
                'Got it',
                'Turn Fyx off',
            )
            .then((choice) => {
                if (choice === 'Turn Fyx off') {
                    void vscode.workspace.getConfiguration('freeagentcoder').update('fyx', false, vscode.ConfigurationTarget.Global);
                }
            });
    }

    /** Watches what the agent runs, so a request it settled with one command can be done by Fyx next time. */
    private watchTurn(message: ToWebview): void {
        if (message.type !== 'toolEnd') {
            return;
        }
        if (message.tool === 'run_command' && message.display?.type === 'command' && !message.display.background) {
            this.turnWatch.runs.push({ command: message.display.command, ok: message.ok });
            // A command that passed after the latest edit: the change was checked.
            if (this.turnWatch.edits > 0) {
                this.turnWatch.okAfterEdit = message.ok;
            }
        } else if ((message.tool === 'write_file' || message.tool === 'edit_file') && message.ok) {
            this.turnWatch.edits++;
            this.turnWatch.okAfterEdit = false;
        }
    }

    private async projectChecks(root: string): Promise<ProjectCheck[]> {
        const cached = this.checksCache;
        if (cached && cached.root === root && Date.now() - cached.at < 60_000) {
            return cached.checks;
        }
        try {
            const checks = await detectChecks(root);
            this.checksCache = { root, at: Date.now(), checks };
            return checks;
        } catch (error) {
            this.errorLog.add({ kind: 'extension', source: 'Project checks', message: errorMessage(error), recovered: true, action: 'Continued without detected checks' });
            return [];
        }
    }

    /** A warning, before work starts, when today's remaining limits may not cover a task of this size. */
    private forecast(shape: TaskShape): TurnPlan['capacity'] {
        const left = this.lastSettings?.overview.promptsLeft;
        if (!left) {
            return undefined;
        }
        const { expected } = requestsNeeded(this.usage.taskStats(7), shape);
        const risk = capacityRisk(left, expected);
        // Quick questions are cheap: only speak up when they clearly won't fit.
        if (!risk || risk === 'ok' || (shape.tier === 'fast' && risk === 'tight')) {
            return undefined;
        }
        return { level: risk, ...capacityMessage(risk, left, expected) };
    }

    /** The reader models for a task's attachments, built from the keys that can serve each job. */
    /** Reads the text in images on this computer: no key, no request, no quota. */
    private localImageReader(): AttachmentReaders['localImages'] {
        const dir = path.join(this.context.globalStorageUri.fsPath, 'ocr');
        return async (images, signal, progress) => {
            try {
                return await readImagesLocally(
                    images.map((image, index) => ({ name: image.name ?? `image ${index + 1}`, bytes: Buffer.from(image.data, 'base64') })),
                    { dir, progress, signal },
                );
            } catch (error) {
                if (signal.aborted) {
                    throw error;
                }
                this.errorLog.add({
                    kind: 'extension',
                    source: 'Text reader',
                    message: errorMessage(error),
                    recovered: true,
                    action: 'Asked a vision model to read the image instead',
                });
                return [];
            }
        };
    }

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
        const detail = error ? `${error.kind.replace(/_/g, ' ')}: ${error.message.replace(/^\w+:\s*/, '').slice(0, 200)}` : undefined;
        this.usage.recordCall(key.id, result.model, { ok: result.ok, latencyMs: result.latencyMs, error: detail });
        if (!error || !detail) {
            return;
        }
        const auth = isAuthFailure(error);
        const daily = error.kind === 'rate_limit' && isDailyLimit(error.message);
        this.lastFailure = `${key.provider}:${daily ? 'daily-limit' : error.kind.replace(/_/g, '-')}`;
        this.usage.setLastError(key.id, detail);
        this.errorLog.add({
            kind: 'provider',
            source: `${providerLabel(key.provider)} · ${key.label}`,
            message: detail,
            recovered: !auth,
            action: auth
                ? 'Marked the key invalid and stopped using it'
                : daily
                  ? 'Set the key aside until its daily limit resets; the next key took over'
                  : 'Handed the request to the next key or model',
        });
        if (error.kind === 'rate_limit') {
            this.usage.recordRateLimit(key.id);
            const limit = dailyLimitFrom(error.message);
            if (limit) {
                this.usage.learnDailyLimit(key.id, limit);
            }
            if (daily) {
                // Without a retry time, look again in a few hours rather than hammering a spent key.
                this.usage.markExhausted(key.id, Date.now() + (error.retryAfterMs ?? 4 * 3_600_000));
                this.warnDailyLimit(key);
            } else {
                this.usage.setCooldown(key.id, Date.now() + (error.retryAfterMs ?? 60_000));
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

    /** Says so once per task when a key runs out of daily quota, so the user can add one before the rest do too. */
    private warnDailyLimit(key: RoutableKey): void {
        const turnId = this.session.turnId;
        if (!turnId || this.dailyWarned.has(key.id)) {
            return;
        }
        this.dailyWarned.add(key.id);
        this.post({
            type: 'notice',
            turnId,
            level: 'warn',
            message: `${providerLabel(key.provider)} · ${key.label} has used today's limit, so your other keys are taking over. If they run out too, the task pauses: adding a key from another provider now keeps it going.`,
        });
    }

    private logTask(entry: SessionLogEntry): void {
        this.errorLog.add(entry);
        if (entry.recovered) {
            this.usage.recordRecovery();
        }
    }

    private async afterTurn(end: Extract<ToWebview, { type: 'turnEnd' }>): Promise<void> {
        const fyx = this.fyxTurn;
        this.fyxTurn = undefined;
        const watched = this.turnWatch;
        if (fyx) {
            if (end.reason === 'completed') {
                this.usage.recordFyx(fyx.saved);
                if (fyx.learned) {
                    void this.learned().used(fyx.prompt);
                }
            }
            this.turnRequests = 0;
            this.telemetry.taskFinished(end.reason === 'completed' ? 'done' : end.reason === 'aborted' ? 'stopped' : 'failed', `fyx:${fyx.kind}`, 'fyx');
            return;
        }
        // The agent settled a short request with one command and nothing else: Fyx can do it next time.
        if (end.reason === 'completed' && watched.edits === 0 && watched.runs.length === 1 && watched.runs[0]!.ok && this.fyxEnabled()) {
            void this.learned().learn(watched.prompt, watched.runs[0]!.command);
        }
        const turnRequests = this.turnRequests;
        this.usage.recordTask({
            tokens: end.tokens,
            requests: turnRequests,
            completed: end.reason === 'completed',
            durationMs: end.durationMs,
            tier: this.session.lastTier ?? 'fast',
        });
        this.turnRequests = 0;
        this.dailyWarned.clear();
        this.telemetry.taskFinished(
            end.reason === 'completed' ? 'done' : end.reason === 'aborted' ? 'stopped' : 'failed',
            end.reason === 'max_steps' ? 'max-steps' : end.reason === 'budget' ? 'token-limit' : (this.lastFailure ?? 'unknown'),
            this.lastSpecialist,
            {
                // A correction means the previous answer was not right: counted against accuracy.
                corrected: !!watched.correction,
                changedCode: watched.edits > 0,
                verified: !!watched.okAfterEdit,
                requests: turnRequests,
                tokens: end.tokens,
            },
        );
        this.lastFailure = undefined;
        void vscode.commands.executeCommand('setContext', 'freeagentcoder.hasRunTask', true);
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
        if (message.provider === 'cerebras') {
            return reply(false, 'Cerebras keys need a paid account now, so FreeAgentCoder no longer uses them. Add a free Gemini, Groq or OpenRouter key instead.');
        }
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

    /**
     * Shows what a task made, beside the code: a dev server it left running,
     * or a page it wrote, served from this computer so that scripts and
     * modules load as they would on a real site. Only a page inside the open
     * folder or an address on this computer is ever opened.
     */
    private async openPreview(kind: 'file' | 'url', target: string): Promise<void> {
        try {
            let url: string | undefined = target;
            if (kind === 'file') {
                const folder = vscode.workspace.workspaceFolders?.[0];
                url = folder ? await this.previews.urlFor(folder.uri.fsPath, target) : undefined;
            } else if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(target)) {
                return;
            }
            if (!url) {
                return;
            }
            const address = url;
            await vscode.commands.executeCommand('simpleBrowser.show', address).then(undefined, () => vscode.env.openExternal(vscode.Uri.parse(address)));
        } catch {
            this.toast(`Couldn't open a preview of ${target}.`, 'error');
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
        // No key of their own yet: the free trial, so the first task works straight away.
        if (!result.length && vscode.workspace.getConfiguration('freeagentcoder').get<boolean>('freeTrial', true) && !this.usage.invalidReason(TRIAL_PROVIDER)) {
            result.push({ id: TRIAL_PROVIDER, provider: TRIAL_PROVIDER, label: 'FreeAgentCoder free trial', secret: `fact_${this.trialId()}` });
        }
        return result;
    }

    /** A random id for the free trial alone, so its daily allowance can be counted. Not linked to anything else. */
    private trialId(): string {
        let id = this.context.globalState.get<string>('freeagentcoder.trialId');
        if (!id) {
            id = crypto.randomUUID();
            void this.context.globalState.update('freeagentcoder.trialId', id);
        }
        return id;
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
        // Ticks off the "Add a free API key" step of the Get Started walkthrough.
        void vscode.commands.executeCommand('setContext', 'freeagentcoder.hasKeys', usable.length > 0);
        const capacity = providerCapacity(views, this.usage.rateLimitsToday(), now);
        const recent = this.usage.taskStats(7);
        const promptsLeft = estimatePromptsLeft({ keys: views, learnedLimits: this.usage.learnedDailyLimits(), recent, now });
        const settings: SettingsView = {
            mode: this.mode,
            model: this.model,
            fyx: this.fyxEnabled(),
            providers: providerViews(String(this.context.extension.packageJSON.version ?? '0.0.0')),
            keys: views,
            usage: { window: this.usage.window(), today: this.usage.today(), month: this.usage.month(), days: this.usage.days(7) },
            routes: this.routes(usable),
            warnings: this.warnings(views, now),
            usableKeys: usable.length,
            capacity,
            suggestions: adviseKeys({ keys: views, capacity, weakFallbacksToday: this.usage.weakFallbacksToday(), recent, promptsLeft, now }),
            overview: await this.overview(promptsLeft, views),
            health: this.healthView(usable, now),
        };
        this.lastSettings = settings;
        return settings;
    }

    /** Every job FreeAgentCoder routes to its own models, and how each key and model serving it is doing. */
    private healthView(usable: KeyView[], now: number): HealthView {
        const load = (id: string) => this.usage.today(id).requests;
        const byId = new Map(usable.map((k) => [k.id, k]));
        const chain = (steps: { model: string; keys: { id: string }[] }[]) =>
            steps.flatMap((step) => step.keys.flatMap((ref) => {
                const key = byId.get(ref.id);
                return key ? [this.healthEntry(key, step.model, now)] : [];
            }));
        const role = (id: RoleHealth['id'], label: string, description: string, entries: HealthEntry[]): RoleHealth => ({
            id,
            label,
            description,
            entries,
            status: roleStatus(entries),
        });
        const quick = chain(planRoute(usable, this.model, 'fast', load).steps);
        const stats = this.errorLog.stats();
        return {
            roles: [
                role('quick', 'Quick tasks', 'Questions, explanations and small edits. Fastest models first.', quick),
                role('complex', 'Complex tasks', 'Builds, debugging, corrections, tests and multi-file work. Strongest models first.', chain(planRoute(usable, this.model, 'deep', load).steps)),
                role(
                    'vision',
                    'Screenshot reader',
                    'Reads pasted screenshots and images before a task starts.',
                    this.features.readAttachments ? chain(planVisionRoute(usable, load)) : [],
                ),
                role(
                    'documents',
                    'Scanned PDF reader',
                    'Reads PDFs with no text layer. Other documents are read on this computer; very long ones are summarized by the complex-task models.',
                    this.features.readAttachments ? usable.filter((k) => k.provider === 'gemini').map((k) => this.healthEntry(k, PDF_READER_MODEL, now)) : [],
                ),
                role('learning', 'Lesson writer', 'Turns your corrections into lessons for later tasks, using the quick-task models.', this.features.learning ? quick : []),
            ],
            recoveredToday: stats.handled,
            unresolvedToday: stats.unresolved,
            checkedAt: now,
        };
    }

    private healthEntry(key: KeyView, model: string, now: number): HealthEntry {
        const calls = this.usage.callHealth(key.id, model);
        const exhausted = this.usage.exhaustedUntil(key.id);
        let status: HealthStatus = 'healthy';
        let statusDetail: string | undefined;
        if (!key.enabled) {
            status = 'disabled';
        } else if (key.status === 'invalid') {
            status = 'invalid';
            statusDetail = key.statusDetail;
        } else if (exhausted) {
            status = 'exhausted';
            statusDetail = `Daily limit used · checked again in ${formatDuration(exhausted - now)}`;
        } else if (key.cooldownUntil && key.cooldownUntil > now) {
            status = 'cooldown';
            statusDetail = `Rate-limited · ready in ${formatDuration(key.cooldownUntil - now)}`;
        } else if (calls && calls.consecutiveFailures >= 3) {
            status = 'failing';
            statusDetail = `${calls.consecutiveFailures} failed requests in a row`;
        } else if (!calls) {
            status = 'untested';
        }
        const successes = calls ? calls.calls - calls.failures : 0;
        return {
            keyId: key.id,
            keyLabel: key.label,
            provider: key.provider,
            providerLabel: key.providerLabel,
            model,
            status,
            statusDetail,
            calls: calls?.calls ?? 0,
            failures: calls?.failures ?? 0,
            avgLatencyMs: calls && successes > 0 ? Math.round(calls.latencyTotalMs / successes) : undefined,
            lastOkAt: calls?.lastOkAt,
            lastError: calls?.lastError,
            lastErrorAt: calls?.lastErrorAt,
        };
    }

    private async overview(promptsLeft: PromptsLeft, views: KeyView[]): Promise<OverviewView> {
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
            savings: estimateSavings(views),
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
        this.lab?.capture(message, { requests: this.turnRequests, fyx: !!this.fyxTurn });
        this.watchTurn(message);
        if (TRANSCRIPT_TYPES.has(message.type)) {
            this.remember(message);
        }
        this.sink?.post(message);
        if (message.type === 'turnEnd') {
            if (message.preview?.auto && vscode.workspace.getConfiguration('freeagentcoder').get<boolean>('openPreview', true)) {
                void this.openPreview(message.preview.kind, message.preview.target);
            }
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
