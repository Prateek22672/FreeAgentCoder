import * as path from 'node:path';
import * as vscode from 'vscode';
import { ModelRouter, PRESETS } from '@agentic/core';
import { configPath, loadConfig, type AgenticConfig } from '@agentic/core/node';
import { classifyTask, isValidModelChoice, KEY_PROVIDERS, parseModelChoice, planRoute, providerLabel, providerViews } from './agent/catalog';
import { ChainBuilder, isAuthFailure, verifyKey, type CallResult, type RoutableKey } from './agent/chain';
import { DIFF_SCHEME, DiffDocuments } from './agent/diffDocuments';
import { AgentSession } from './agent/session';
import { KeyStore } from './keys/keyStore';
import { parseQuotaHeaders } from './keys/quota';
import { compactNumber, errorMessage, formatDuration } from './shared/format';
import {
    AUTO_MODEL,
    type FromWebview,
    type KeySource,
    type KeyStatus,
    type KeyView,
    type PermissionMode,
    type RouteView,
    type SettingsView,
    type Tier,
    type ToWebview,
} from './shared/protocol';
import { UsageStore } from './usage/usageStore';

const MODE_KEY = 'freeagentcoder.mode';
const MODEL_KEY = 'freeagentcoder.model';
const DISABLED_EXTERNAL_KEY = 'freeagentcoder.disabledExternalKeys';
const TRANSCRIPT_LIMIT = 20_000;
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

/** The extension-side brain: keys, usage, routing, and the chat session. */
export class Controller implements vscode.Disposable {
    private readonly keys: KeyStore;
    private readonly usage: UsageStore;
    private readonly diffs = new DiffDocuments();
    private readonly router = new ModelRouter([]);
    private readonly chain: ChainBuilder;
    private readonly session: AgentSession;
    private readonly disposables: vscode.Disposable[] = [];
    private sink?: ViewSink;
    private transcript: ToWebview[] = [];
    private mode: PermissionMode;
    private model: string;
    private settingsTimer?: ReturnType<typeof setTimeout>;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.keys = new KeyStore(context);
        this.usage = new UsageStore(context);

        const savedMode = context.globalState.get<string>(MODE_KEY);
        this.mode = savedMode === 'ask' || savedMode === 'auto-edit' || savedMode === 'auto' ? savedMode : 'auto-edit';
        const savedModel = context.globalState.get<string>(MODEL_KEY);
        this.model = isValidModelChoice(savedModel) ? savedModel : AUTO_MODEL;

        this.chain = new ChainBuilder({
            onAttempt: (key, model) => {
                const turnId = this.session.turnId;
                if (turnId) {
                    this.post({ type: 'model', turnId, providerLabel: providerLabel(key.provider), model, keyLabel: key.label });
                }
            },
            onResult: (key, result) => this.onCallResult(key, result),
            onHeaders: (key, headers) => this.usage.recordQuota(key.id, parseQuotaHeaders(headers)),
        });
        this.session = new AgentSession({
            router: this.router,
            diffs: this.diffs,
            post: (message) => this.post(message),
            mode: () => this.mode,
        });

        this.disposables.push(
            this.keys,
            this.usage,
            this.session,
            vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, this.diffs),
            this.keys.onDidChange(() => this.scheduleSettings()),
            this.usage.onDidChange(() => this.scheduleSettings()),
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this.session.resetWorkspace();
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
            this.post({ type: 'toast', level: 'error', message: errorMessage(error) });
        }
    }

    dispose(): void {
        clearTimeout(this.settingsTimer);
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
                return;
            }
            case 'send':
                return this.send(message.text);
            case 'continue':
                return this.send('Continue where you left off.');
            case 'stop':
                this.session.stop();
                return;
            case 'newChat':
                await this.session.newChat();
                this.transcript = [];
                this.post({ type: 'reset' });
                this.post({ type: 'usage', ...this.session.usageInfo() });
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
            case 'undo':
                return this.session.undo(message.turnId);
            case 'openFolder':
                await vscode.commands.executeCommand('vscode.openFolder');
                return;
        }
    }

    private async send(text: string): Promise<void> {
        const prompt = text.trim();
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

        const selected = parseModelChoice(this.model);
        const { tier, reason } = selected
            ? { tier: 'deep' as Tier, reason: `Selected model: ${providerLabel(selected.provider)} · ${selected.model}` }
            : classifyTask(prompt, this.session.lastTier);
        const route = planRoute(keys, this.model, tier, (id) => this.usage.today(id).requests);
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
        await this.session.run(folder.uri.fsPath, prompt, { tier, tierReason: reason, pinned: !!selected, notes: route.note ? [route.note] : [] });
    }

    private onCallResult(key: RoutableKey, result: CallResult): void {
        this.usage.record(key.id, {
            ok: result.ok,
            inputTokens: result.usage?.inputTokens ?? 0,
            outputTokens: result.usage?.outputTokens ?? 0,
        });
        const error = result.error;
        if (!error) {
            return;
        }
        if (error.kind === 'rate_limit') {
            this.usage.setCooldown(key.id, Date.now() + (error.retryAfterMs ?? 60_000));
        } else if (isAuthFailure(error)) {
            const reason = error.message.replace(/^\w+:\s*/, '').slice(0, 160);
            if (this.keys.get(key.id)) {
                void this.keys.update(key.id, { invalidReason: reason });
            } else {
                this.usage.setInvalid(key.id, reason);
            }
        }
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
            reply(true, `Saved "${key.label}". ${check.message}`);
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
            { modal: true, detail: 'The key is deleted from VS Code Secret Storage, along with its usage history.' },
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
        return {
            mode: this.mode,
            model: this.model,
            providers: providerViews(),
            keys: views,
            usage: { window: this.usage.window(), today: this.usage.today(), month: this.usage.month(), days: this.usage.days(7) },
            routes: this.routes(usable),
            warnings: this.warnings(views, now),
            usableKeys: usable.length,
        };
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
            { title: 'Complex tasks', description: 'Building, debugging and multi-file changes', steps: describe('deep') },
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
