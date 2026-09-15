export type PermissionMode = 'ask' | 'auto-edit' | 'auto';
export type Tier = 'fast' | 'deep';
export type KeyStatus = 'active' | 'cooldown' | 'invalid' | 'disabled' | 'unverified';
export type KeySource = 'extension' | 'env' | 'config';
export type SettingsSection = 'keys' | 'usage' | 'model' | 'permissions';
export type TurnEndReason = 'completed' | 'max_steps' | 'aborted' | 'error';

export const AUTO_MODEL = 'auto';

export interface UsageCounts {
    requests: number;
    errors: number;
    inputTokens: number;
    outputTokens: number;
}

export interface QuotaWindow {
    /** "requests", "tokens", "input tokens", … as the provider names it. */
    dimension: string;
    /** "minute", "day", "month" when the provider says which window. */
    period?: string;
    limit: number;
    remaining: number;
    resetAt?: number;
}

export interface QuotaSnapshot {
    capturedAt: number;
    windows: QuotaWindow[];
}

export interface KeyView {
    id: string;
    provider: string;
    providerLabel: string;
    label: string;
    last4: string;
    source: KeySource;
    sourceDetail?: string;
    createdAt?: number;
    verifiedAt?: number;
    enabled: boolean;
    status: KeyStatus;
    statusDetail?: string;
    cooldownUntil?: number;
    lastUsedAt?: number;
    today: UsageCounts;
    month: UsageCounts;
    window: UsageCounts;
    quota?: QuotaSnapshot;
}

export interface ProviderView {
    id: string;
    label: string;
    free: boolean;
    models: string[];
    defaultModel: string;
    signupUrl: string;
    note: string;
}

export interface RouteView {
    title: string;
    description: string;
    steps: string[];
}

export interface UsageDay {
    day: string;
    tokens: number;
    requests: number;
}

export interface UsageView {
    window: UsageCounts;
    today: UsageCounts;
    month: UsageCounts;
    days: UsageDay[];
}

export interface SettingsView {
    mode: PermissionMode;
    model: string;
    providers: ProviderView[];
    keys: KeyView[];
    usage: UsageView;
    routes: RouteView[];
    warnings: string[];
    usableKeys: number;
}

export interface TodoView {
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
}

export interface DiffLineView {
    kind: 'add' | 'del' | 'ctx' | 'gap';
    text: string;
    line?: number;
}

export type ToolDisplayView =
    | { type: 'diff'; path: string; created: boolean; lines: DiffLineView[]; added: number; removed: number; truncated: boolean }
    | { type: 'command'; command: string; output: string; exitCode: number | null; timedOut?: boolean; background?: boolean }
    | { type: 'text'; text: string };

export interface ApprovalView {
    id: string;
    tool: string;
    kind: string;
    label: string;
    reason: string;
    command?: string;
    url?: string;
    paths: string[];
    outsideProject: boolean;
    canRemember: boolean;
    dangerous: boolean;
    preview?: ToolDisplayView;
}

export interface ChangedFile {
    path: string;
    created: boolean;
    added: number;
    removed: number;
    diffId: string;
}

export type ToWebview =
    | { type: 'state'; settings: SettingsView; running: boolean; hasWorkspace: boolean }
    | { type: 'settings'; settings: SettingsView }
    | { type: 'turnStart'; turnId: string; prompt: string; tier: Tier; tierReason: string; pinned: boolean; at: number }
    | { type: 'model'; turnId: string; providerLabel: string; model: string; keyLabel: string }
    | { type: 'text'; turnId: string; delta: string }
    | { type: 'reasoning'; turnId: string; delta: string }
    | { type: 'resetText'; turnId: string }
    | { type: 'assistant'; turnId: string; content: string }
    | { type: 'preparing'; turnId: string; tool: string }
    | { type: 'toolStart'; turnId: string; callId: string; tool: string; label: string }
    | { type: 'toolOutput'; turnId: string; callId: string; chunk: string }
    | {
          type: 'toolEnd';
          turnId: string;
          callId: string;
          tool: string;
          label: string;
          ok: boolean;
          denied: boolean;
          summary?: string;
          display?: ToolDisplayView;
          diffId?: string;
          error?: string;
      }
    | { type: 'approval'; turnId: string; approval: ApprovalView }
    | { type: 'approvalResolved'; turnId: string; id: string; allowed: boolean }
    | { type: 'todos'; turnId: string; todos: TodoView[] }
    | { type: 'notice'; turnId: string; message: string; level: 'info' | 'warn' }
    | { type: 'error'; turnId?: string; message: string; hint?: string; action?: 'openKeys' | 'openFolder' }
    | {
          type: 'turnEnd';
          turnId: string;
          reason: TurnEndReason;
          steps: number;
          durationMs: number;
          tokens: number;
          files: ChangedFile[];
          canUndo: boolean;
      }
    | { type: 'undone'; turnId: string; restored: string[]; deleted: string[] }
    | { type: 'usage'; sessionTokens: number; contextTokens: number; contextLimit: number }
    | { type: 'reset' }
    | { type: 'toast'; message: string; level: 'info' | 'error' }
    | { type: 'keyResult'; requestId: string; ok: boolean; message: string }
    | { type: 'keyTest'; id: string; ok: boolean; message: string }
    | { type: 'showSettings'; section?: SettingsSection }
    | { type: 'focusInput' };

export type FromWebview =
    | { type: 'ready' }
    | { type: 'send'; text: string }
    | { type: 'stop' }
    | { type: 'continue' }
    | { type: 'newChat' }
    | { type: 'approve'; id: string; allow: boolean; remember?: boolean; feedback?: string }
    | { type: 'setMode'; mode: PermissionMode }
    | { type: 'setModel'; model: string }
    | { type: 'addKey'; requestId: string; provider: string; label: string; secret: string }
    | { type: 'renameKey'; id: string; label: string }
    | { type: 'toggleKey'; id: string; enabled: boolean }
    | { type: 'removeKey'; id: string }
    | { type: 'testKey'; id: string }
    | { type: 'openFile'; path: string; line?: number }
    | { type: 'openDiff'; diffId: string; title: string }
    | { type: 'openExternal'; url: string }
    | { type: 'copy'; text: string }
    | { type: 'undo'; turnId: string }
    | { type: 'openFolder' };
