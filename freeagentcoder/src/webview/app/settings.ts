import { compactNumber, formatAgo, formatDate, formatDuration, fullNumber } from '../../shared/format';
import { detectProvider, KEY_STEPS } from '../../shared/keyFormat';
import type {
    CapacityWindow,
    KeyView,
    LessonView,
    LogEntry,
    LogKind,
    PermissionMode,
    ProviderView,
    QuotaWindow,
    SettingsSection,
    SettingsView,
    ToWebview,
    UsageCounts,
} from '../../shared/protocol';
import { button, h, handleContentClick, iconButton, send } from './dom';
import { icon, type IconName } from './icons';

type Msg<T extends ToWebview['type']> = Extract<ToWebview, { type: T }>;

const TABS: [SettingsSection, string, IconName][] = [
    ['overview', 'Overview', 'grid'],
    ['keys', 'API Keys', 'key'],
    ['usage', 'Usage', 'gauge'],
    ['memory', 'Memory', 'brain'],
    ['history', 'History', 'history'],
    ['model', 'Model', 'layers'],
    ['permissions', 'Permissions', 'shield'],
    ['logs', 'Logs', 'pulse'],
];

const DESCRIPTIONS: Record<SettingsSection, string> = {
    overview: "Prompts left today, this project's status, and the features you can turn on or off.",
    memory: "Lessons from your corrections, added to future tasks so the same mistake isn't repeated.",
    keys: 'Add several keys per provider: when one hits its limit, the next takes over.',
    usage: 'Counted on this machine from every provider response, with advice on how many keys you need.',
    history: 'Reopen, search and delete your past conversations.',
    model: 'How each request picks a model.',
    permissions: 'What FreeAgentCoder may do without asking first.',
    logs: 'Errors on this computer, and what FreeAgentCoder did about each one.',
};

function tokens(counts: UsageCounts): number {
    return counts.inputTokens + counts.outputTokens;
}

function statusText(key: KeyView): string {
    switch (key.status) {
        case 'active':
            return key.lastUsedAt ? `Active · used ${formatAgo(key.lastUsedAt)}` : 'Active · verified';
        case 'unverified':
            return 'Not used yet';
        case 'cooldown':
            return `Rate-limited${key.statusDetail ? ` · ${key.statusDetail.toLowerCase()}` : ''}`;
        case 'invalid':
            return 'Invalid key';
        case 'disabled':
            return 'Disabled';
    }
}

function tightest(windows: QuotaWindow[]): QuotaWindow | undefined {
    return [...windows].sort((a, b) => a.remaining / a.limit - b.remaining / b.limit)[0];
}

function bar(fraction: number): HTMLElement {
    const fill = h('div', { class: 'bar-fill' });
    fill.style.width = `${Math.max(2, Math.min(100, fraction * 100))}%`;
    return h('div', { class: 'bar' }, fill);
}

function quotaBar(window: QuotaWindow, compact: boolean): HTMLElement {
    const fraction = window.remaining / window.limit;
    const tone = fraction <= 0.1 ? 'bad' : fraction <= 0.3 ? 'warn' : 'ok';
    const now = Date.now();
    const reset = window.resetAt ? (window.resetAt > now ? `resets in ${formatDuration(window.resetAt - now)}` : 'has reset since') : '';
    const name = `${window.dimension.charAt(0).toUpperCase()}${window.dimension.slice(1)}${window.period ? ` per ${window.period}` : ''}`;
    return h(
        'div',
        { class: `quota ${tone}${compact ? ' compact' : ''}` },
        h(
            'div',
            { class: 'quota-line' },
            h('span', { text: name }),
            h('span', { class: 'muted', text: `${compactNumber(window.remaining)} of ${compactNumber(window.limit)} left${reset ? ` · ${reset}` : ''}` }),
        ),
        bar(fraction),
    );
}

function capacityBar(window: CapacityWindow, usableKeys: number): HTMLElement {
    const fraction = window.limit ? window.used / window.limit : 0;
    const tone = fraction >= 0.9 ? 'bad' : fraction >= 0.7 ? 'warn' : 'ok';
    const now = Date.now();
    const reset = window.resetAt && window.resetAt > now ? ` · resets in ${formatDuration(window.resetAt - now)}` : '';
    const coverage = window.reportingKeys < usableKeys ? ` · ${window.reportingKeys} of ${usableKeys} keys report it` : '';
    return h(
        'div',
        { class: `quota ${tone}` },
        h(
            'div',
            { class: 'quota-line' },
            h('span', { text: window.name }),
            h('span', { class: 'muted', text: `${compactNumber(window.used)} of ${compactNumber(window.limit)} used${reset}${coverage}` }),
        ),
        bar(fraction),
    );
}

function usageTable(rows: [string, UsageCounts][]): HTMLElement {
    return h(
        'table',
        { class: 'usage-table' },
        h('thead', {}, h('tr', {}, h('th', { text: '' }), h('th', { text: 'Requests' }), h('th', { text: 'Input' }), h('th', { text: 'Output' }))),
        h(
            'tbody',
            {},
            ...rows.map(([label, c]) =>
                h(
                    'tr',
                    {},
                    h('td', { text: label }),
                    h('td', { text: `${fullNumber(c.requests)}${c.errors ? ` (${c.errors} failed)` : ''}` }),
                    h('td', { text: compactNumber(c.inputTokens) }),
                    h('td', { text: compactNumber(c.outputTokens) }),
                ),
            ),
        ),
    );
}

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
    return h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), control, hint ? h('span', { class: 'field-hint', text: hint }) : null);
}

function radioCard(selected: boolean, iconName: IconName, title: string, description: string, onSelect: () => void, extra?: HTMLElement | null): HTMLElement {
    const card = h(
        'div',
        { class: `radio-card${selected ? ' selected' : ''}`, attrs: { role: 'radio', 'aria-checked': String(selected), tabindex: '0' } },
        h('div', { class: 'radio-main' }, h('span', { class: 'radio-dot' }), icon(iconName), h('div', { class: 'radio-text' }, h('strong', { text: title }), h('span', { text: description }))),
        extra ?? null,
    );
    card.addEventListener('click', (event) => {
        if (!(event.target as HTMLElement).closest('select, input, button')) {
            onSelect();
        }
    });
    card.addEventListener('keydown', (event) => {
        if ((event.key === 'Enter' || event.key === ' ') && event.target === card) {
            event.preventDefault();
            onSelect();
        }
    });
    return card;
}

function switchRow(label: string, on: boolean, description: string, onChange: (on: boolean) => void): HTMLElement {
    const toggle = h('button', { class: `switch${on ? ' on' : ''}`, attrs: { type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': label } }, h('span', { class: 'switch-knob' }));
    toggle.addEventListener('click', () => onChange(!on));
    return h('div', { class: 'switch-row' }, h('div', { class: 'switch-text' }, h('strong', { text: label }), h('span', { class: 'muted small', text: description })), toggle);
}

function trustCard(): HTMLElement {
    return h(
        'div',
        { class: 'trust-card' },
        icon('lock'),
        h(
            'div',
            {},
            h('strong', { text: 'Your API keys stay on this device' }),
            h('span', {
                text: "They're stored encrypted in VS Code Secret Storage (your operating system's keychain), never uploaded to FreeAgentCoder or anyone else, and sent only to the provider each key belongs to when you run a task.",
            }),
        ),
    );
}

function suggestionCard(s: SettingsView['suggestions'][number], onAddKey: (provider?: string) => void): HTMLElement {
    return h(
        'div',
        { class: `suggestion-card ${s.level}` },
        icon(s.level === 'warn' ? 'alert' : 'bulb'),
        h('div', { class: 'suggestion-text' }, h('strong', { text: s.title }), h('span', { text: s.detail })),
        s.action === 'addKey' ? button('Add key', 'secondary small', () => onAddKey(s.provider), 'plus') : null,
    );
}

function groupLabel(time: number, now: number): string {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const today = start.getTime();
    if (time >= today) {
        return 'Today';
    }
    if (time >= today - 86_400_000) {
        return 'Yesterday';
    }
    return time >= today - 7 * 86_400_000 ? 'Previous 7 days' : 'Older';
}

function logRow(entry: LogEntry): HTMLElement {
    return h(
        'div',
        { class: `log-row ${entry.recovered ? 'handled' : 'unresolved'}` },
        icon(entry.recovered ? 'check' : 'alert'),
        h(
            'div',
            { class: 'log-main' },
            h(
                'div',
                { class: 'log-head' },
                h('span', { class: 'tag', text: entry.kind === 'agent' ? 'TASK' : entry.kind.toUpperCase() }),
                h('span', { class: 'log-source', text: entry.source }),
                h('span', { class: 'muted', text: `${formatAgo(entry.at)}${entry.count > 1 ? ` · ×${entry.count}` : ''}` }),
            ),
            h('div', { class: 'log-message', text: entry.message, title: entry.message }),
            h('div', { class: 'log-action', text: entry.recovered ? `Handled: ${entry.action ?? 'recovered automatically'}` : `Not recovered${entry.action ? `: ${entry.action}` : ''}` }),
        ),
    );
}

class AddKeyForm {
    readonly el = h('div', { class: 'card add-key', hidden: true });
    private readonly provider = h('select', { class: 'input' });
    private readonly note = h('p', {});
    private readonly steps = h('ol', { class: 'key-steps' });
    private readonly getKey: HTMLButtonElement;
    private readonly name = h('input', { class: 'input', attrs: { type: 'text', placeholder: 'e.g. Personal, College, Work', maxlength: '40' } });
    private readonly secret = h('input', { class: 'input mono', attrs: { type: 'password', placeholder: 'Paste your API key', autocomplete: 'off', spellcheck: 'false' } });
    private readonly detected = h('span', { class: 'detected', hidden: true });
    private readonly error = h('div', { class: 'inline-result bad', hidden: true });
    private readonly reveal: HTMLButtonElement;
    private readonly paste: HTMLButtonElement;
    private readonly save: HTMLButtonElement;
    private providers: ProviderView[] = [];
    private requestId?: string;
    /** Set when the provider was chosen by the user, so pasting a key doesn't override them. */
    private pickedByUser = false;

    constructor() {
        this.reveal = iconButton('eye', 'Show or hide the key', () => {
            const show = this.secret.type === 'password';
            this.secret.type = show ? 'text' : 'password';
            this.reveal.replaceChildren(icon(show ? 'eyeOff' : 'eye'));
        });
        this.paste = iconButton('copy', 'Paste the key you just copied', () => send({ type: 'pasteClipboard' }));
        this.getKey = button('Get a free key', 'secondary small', () => this.openSignup(), 'external');
        this.save = button('Save key', 'primary', () => this.submit(), 'check');
        this.provider.addEventListener('change', () => {
            this.pickedByUser = true;
            this.describe();
        });
        this.secret.addEventListener('input', () => this.onSecretChanged());
        this.secret.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                this.submit();
            }
        });
        this.el.append(
            h('div', { class: 'card-head' }, icon('key'), h('span', { class: 'card-title', text: 'Add API key' })),
            h(
                'div',
                { class: 'card-body form' },
                field('Provider', this.provider),
                h('div', { class: 'provider-note' }, this.note, this.steps, this.getKey),
                field('Name', this.name, 'So you can tell your keys apart.'),
                field('API key', h('div', { class: 'secret-field' }, this.secret, this.paste, this.reveal), 'Checked with the provider, then stored encrypted on this device.'),
                this.detected,
                h(
                    'div',
                    { class: 'callout' },
                    icon('lock'),
                    h('span', {
                        text: 'Your key stays on this device, encrypted in VS Code Secret Storage. It is never uploaded to FreeAgentCoder or anyone else, and is sent only to this provider when you run a task.',
                    }),
                ),
                this.error,
                h('div', { class: 'form-actions' }, button('Cancel', 'secondary', () => this.close()), this.save),
            ),
        );
    }

    setProviders(providers: ProviderView[]): void {
        const selected = this.provider.value;
        this.providers = providers;
        this.provider.replaceChildren(
            ...providers.map((p) => {
                const option = h('option', { text: `${p.label} — ${p.free ? 'free tier' : 'paid'}`, attrs: { value: p.id } });
                option.selected = p.id === selected;
                return option;
            }),
        );
        this.describe();
    }

    open(providerId?: string): void {
        this.el.hidden = false;
        if (providerId) {
            this.provider.value = providerId;
            this.pickedByUser = true;
        }
        this.describe();
        this.error.hidden = true;
        (providerId ? this.secret : this.provider).focus();
        this.el.scrollIntoView({ block: 'nearest' });
    }

    /** The clipboard text, after the user pressed Paste. */
    clipboard(text: string): void {
        const key = text.trim();
        if (!key) {
            this.showError('The clipboard is empty. Copy your key from the provider first.');
            return;
        }
        this.secret.value = key;
        this.error.hidden = true;
        this.onSecretChanged();
        this.secret.focus();
    }

    result(message: Msg<'keyResult'>): boolean {
        if (message.requestId !== this.requestId) {
            return false;
        }
        this.requestId = undefined;
        this.setBusy(false);
        if (message.ok) {
            this.close();
            return true;
        }
        this.showError(message.message);
        return false;
    }

    private close(): void {
        this.el.hidden = true;
        this.name.value = '';
        this.secret.value = '';
        this.secret.type = 'password';
        this.reveal.replaceChildren(icon('eye'));
        this.error.hidden = true;
        this.detected.hidden = true;
        this.pickedByUser = false;
    }

    private openSignup(): void {
        const url = this.current()?.signupUrl;
        if (url) {
            send({ type: 'openExternal', url });
        }
    }

    /** A pasted key names its own provider, so switch to it unless the user chose one. */
    private onSecretChanged(): void {
        const provider = detectProvider(this.secret.value);
        const known = provider && this.providers.some((p) => p.id === provider);
        if (known && !this.pickedByUser && this.provider.value !== provider) {
            this.provider.value = provider;
            this.describe();
        }
        const label = known ? this.providers.find((p) => p.id === provider)?.label : undefined;
        const mismatch = known && this.provider.value !== provider;
        this.detected.hidden = !label;
        if (label) {
            this.detected.replaceChildren(
                icon(mismatch ? 'alert' : 'check'),
                h('span', {
                    text: mismatch
                        ? `That looks like a ${label} key, but ${this.current()?.label ?? 'another provider'} is selected.`
                        : `Recognised as a ${label} key.`,
                }),
            );
            this.detected.classList.toggle('warn', !!mismatch);
        }
    }

    private current(): ProviderView | undefined {
        return this.providers.find((p) => p.id === this.provider.value);
    }

    private describe(): void {
        const provider = this.current();
        this.note.textContent = provider?.note ?? '';
        this.getKey.hidden = !provider?.signupUrl;
        const label = this.getKey.querySelector('span');
        if (label) {
            label.textContent = provider?.free ? 'Get a free key' : 'Get a key';
        }
        this.getKey.title = provider?.signupUrl ? `Opens ${provider.signupUrl} in your browser` : '';
        const steps = provider ? (KEY_STEPS[provider.id] ?? []) : [];
        this.steps.replaceChildren(...steps.map((step) => h('li', { text: step })));
        this.steps.hidden = !steps.length;
    }

    private submit(): void {
        if (this.requestId) {
            return;
        }
        const secret = this.secret.value.trim();
        if (!secret) {
            this.showError('Paste your API key.');
            return;
        }
        this.requestId = `key-${Date.now()}`;
        this.error.hidden = true;
        this.setBusy(true);
        send({ type: 'addKey', requestId: this.requestId, provider: this.provider.value, label: this.name.value, secret });
    }

    private showError(message: string): void {
        this.error.hidden = false;
        this.error.replaceChildren(icon('alert'), h('span', { text: message }));
    }

    private setBusy(busy: boolean): void {
        this.save.disabled = busy;
        const label = this.save.querySelector('span');
        if (label) {
            label.textContent = busy ? 'Verifying…' : 'Save key';
        }
    }
}

export class SettingsPanel {
    readonly el = h('div', { class: 'settings' });
    private readonly nav = h('nav', { class: 'settings-nav', attrs: { role: 'tablist' } });
    private readonly scroller = h('div', { class: 'settings-scroll' });
    private readonly form = new AddKeyForm();
    private readonly keySummary = h('div', { class: 'key-summary' });
    private readonly keyGroups = h('div', { class: 'key-groups' });
    private readonly historySearch = h('input', { class: 'input', attrs: { type: 'search', placeholder: 'Search saved chats' } });
    private readonly historyList = h('div', { class: 'history-list' });
    private readonly lessonInput = h('input', { class: 'input', attrs: { type: 'text', maxlength: '240', placeholder: 'e.g. Use pnpm, not npm' } });
    private readonly lessonScope = h(
        'select',
        { class: 'input', attrs: { 'aria-label': 'Where the lesson applies' } },
        h('option', { text: 'This project', attrs: { value: 'project' } }),
        h('option', { text: 'All projects', attrs: { value: 'global' } }),
    );
    private readonly sections: Record<SettingsSection, { el: HTMLElement; content: HTMLElement }>;
    private readonly expanded = new Set<string>();
    private readonly renaming = new Set<string>();
    private readonly testing = new Set<string>();
    private readonly testResults = new Map<string, { ok: boolean; message: string }>();
    private active: SettingsSection = 'overview';
    private logFilter: 'all' | LogKind = 'all';
    private data?: SettingsView;
    private historyState?: Msg<'history'>;
    private logsState?: Msg<'logs'>;

    constructor(private readonly options: { close: () => void; toast: (message: string, level: 'info' | 'error') => void }) {
        const make = (id: SettingsSection, ...children: HTMLElement[]) => {
            const content = h('div', { class: 'section-content' }, ...children);
            const label = TABS.find(([tab]) => tab === id)?.[1] ?? id;
            const el = h('section', { class: 'settings-section', attrs: { role: 'tabpanel' } }, h('h2', { text: label }), h('p', { class: 'section-desc', text: DESCRIPTIONS[id] }), content);
            return { el, content };
        };
        this.sections = {
            overview: make('overview'),
            keys: make('keys', trustCard(), this.keySummary, button('Add API key', 'primary block', () => this.form.open(), 'plus'), this.form.el, this.keyGroups),
            usage: make('usage'),
            memory: make('memory'),
            history: make('history'),
            model: make('model'),
            permissions: make('permissions'),
            logs: make('logs'),
        };
        this.lessonInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                this.saveLesson();
            }
        });
        this.historySearch.addEventListener('input', () => this.renderHistoryList());
        this.scroller.append(...Object.values(this.sections).map((s) => s.el));
        this.scroller.addEventListener('click', handleContentClick);
        this.el.append(
            h('div', { class: 'settings-header' }, iconButton('back', 'Back to chat', options.close), h('span', { class: 'settings-title', text: 'Settings' })),
            this.nav,
            this.scroller,
        );
        this.setActive('overview');
    }

    update(data: SettingsView): void {
        this.data = data;
        this.form.setProviders(data.providers);
        this.renderOverview();
        this.renderMemory();
        this.renderKeys();
        this.renderUsage();
        this.renderModel();
        this.renderPermissions();
    }

    history(message: Msg<'history'>): void {
        this.historyState = message;
        this.renderHistory();
    }

    logs(message: Msg<'logs'>): void {
        this.logsState = message;
        this.renderLogs();
        this.renderTabs();
    }

    show(target?: SettingsSection): void {
        this.setActive(target ?? this.active);
        requestAnimationFrame(() => {
            if (this.active === 'keys' && this.data && !this.data.keys.length) {
                this.form.open();
            }
            if (this.active === 'history') {
                this.historySearch.focus();
            }
        });
    }

    keyResult(message: Msg<'keyResult'>): void {
        if (this.form.result(message)) {
            this.options.toast(message.message, 'info');
        }
    }

    clipboard(message: Msg<'clipboard'>): void {
        this.form.clipboard(message.text);
    }

    keyTest(message: Msg<'keyTest'>): void {
        this.testing.delete(message.id);
        this.testResults.set(message.id, { ok: message.ok, message: message.message });
        this.expanded.add(message.id);
        this.renderKeys();
    }

    private setActive(id: SettingsSection): void {
        this.active = id;
        for (const [key, section] of Object.entries(this.sections) as [SettingsSection, { el: HTMLElement }][]) {
            section.el.hidden = key !== id;
        }
        this.scroller.scrollTop = 0;
        this.renderTabs();
    }

    private renderTabs(): void {
        this.nav.replaceChildren(
            ...TABS.map(([id, label, iconName]) => {
                const count = id === 'logs' ? (this.logsState?.stats.unresolved ?? 0) : 0;
                const chip = h(
                    'button',
                    { class: `nav-chip${this.active === id ? ' active' : ''}`, attrs: { type: 'button', role: 'tab', 'aria-selected': String(this.active === id) } },
                    icon(iconName),
                    h('span', { text: label }),
                    count ? h('span', { class: 'nav-count', text: String(count), title: `${count} not recovered today` }) : null,
                );
                chip.addEventListener('click', () => this.setActive(id));
                return chip;
            }),
        );
    }

    private openAddKey(provider?: string): void {
        this.setActive('keys');
        this.form.open(provider);
    }

    private renderKeys(): void {
        const data = this.data;
        if (!data) {
            return;
        }
        const keys = data.keys;
        const count = (predicate: (k: KeyView) => boolean) => keys.filter(predicate).length;
        const stats: [number, string, string][] = [
            [count((k) => k.status === 'active' || k.status === 'unverified'), 'active', 'ready'],
            [count((k) => k.status === 'cooldown'), 'cooldown', 'rate-limited'],
            [count((k) => k.status === 'invalid'), 'invalid', 'invalid'],
            [count((k) => k.status === 'disabled'), 'disabled', 'disabled'],
        ];
        this.keySummary.replaceChildren(
            ...stats
                .filter(([n], index) => n > 0 || (index === 0 && keys.length > 0))
                .map(([n, status, label]) => h('span', { class: 'pill-stat' }, h('span', { class: `status-dot ${status}` }), `${n} ${label}`)),
        );
        this.keySummary.hidden = !keys.length;

        const groups: HTMLElement[] = [];
        if (!keys.length) {
            groups.push(
                h(
                    'div',
                    { class: 'empty-card' },
                    icon('key'),
                    h('strong', { text: 'No API keys yet' }),
                    h('span', { text: 'Gemini, Groq and Cerebras have free tiers. Each key takes about a minute to create.' }),
                ),
            );
        }
        for (const provider of data.providers) {
            const providerKeys = keys.filter((k) => k.provider === provider.id);
            if (!providerKeys.length) {
                continue;
            }
            groups.push(
                h(
                    'div',
                    { class: 'provider-group' },
                    h(
                        'div',
                        { class: 'provider-head' },
                        h('span', { class: 'provider-name', text: provider.label }),
                        h('span', { class: `tag ${provider.free ? 'free' : 'paid'}`, text: provider.free ? 'FREE TIER' : 'PAID' }),
                        h('span', { class: 'muted', text: `${providerKeys.length} key${providerKeys.length === 1 ? '' : 's'}` }),
                        iconButton('plus', `Add another ${provider.label} key`, () => this.form.open(provider.id)),
                    ),
                    ...providerKeys.map((key) => this.keyCard(key)),
                ),
            );
        }

        const missing = data.providers.filter((p) => p.free && !keys.some((k) => k.provider === p.id));
        if (missing.length) {
            groups.push(
                h(
                    'div',
                    { class: 'available' },
                    h('div', { class: 'subhead', text: keys.length ? 'Add more free capacity' : 'Free providers' }),
                    ...missing.map((p) =>
                        h(
                            'div',
                            { class: 'available-row' },
                            h('div', { class: 'available-text' }, h('strong', { text: p.label }), h('span', { class: 'muted', text: p.note, title: p.note })),
                            h('a', { class: 'link', text: 'Get key ↗', attrs: { href: p.signupUrl, 'data-external': '1' } }),
                            button('Add', 'secondary small', () => this.form.open(p.id)),
                        ),
                    ),
                ),
            );
        }
        this.keyGroups.replaceChildren(...groups);
    }

    private keyCard(key: KeyView): HTMLElement {
        const expanded = this.expanded.has(key.id);
        const card = h('div', { class: `key-card status-${key.status}${expanded ? ' expanded' : ''}` });
        const main = h(
            'button',
            { class: 'key-main', attrs: { type: 'button', 'aria-expanded': String(expanded) } },
            h('span', { class: `status-dot ${key.status}` }),
            h(
                'span',
                { class: 'key-text' },
                h(
                    'span',
                    { class: 'key-name' },
                    h('span', { text: key.label }),
                    key.source !== 'extension' ? h('span', { class: 'tag', text: key.source === 'env' ? 'ENV' : 'CLI', title: key.sourceDetail }) : null,
                ),
                h('span', { class: 'key-sub', text: `${statusText(key)} · ••••${key.last4}` }),
            ),
            h('span', { class: 'key-usage', text: `${compactNumber(tokens(key.today))} today` }),
            icon('chevronDown', 'caret'),
        );
        main.addEventListener('click', () => {
            if (this.expanded.has(key.id)) {
                this.expanded.delete(key.id);
            } else {
                this.expanded.add(key.id);
            }
            this.renderKeys();
        });
        card.append(main);
        const tight = key.quota ? tightest(key.quota.windows) : undefined;
        if (tight && !expanded) {
            card.append(quotaBar(tight, true));
        }
        if (expanded) {
            card.append(this.keyDetails(key));
        }
        return card;
    }

    private keyDetails(key: KeyView): HTMLElement {
        const facts: [string, string][] = [
            ['Provider', key.providerLabel],
            ['Key', `••••••••••••${key.last4}`],
            ['Source', key.source === 'extension' ? 'Added in FreeAgentCoder' : (key.sourceDetail ?? '')],
        ];
        if (key.createdAt) {
            facts.push(['Added', formatDate(key.createdAt)]);
        }
        if (key.verifiedAt) {
            facts.push(['Verified', formatAgo(key.verifiedAt)]);
        }
        facts.push(['Last used', key.lastUsedAt ? formatAgo(key.lastUsedAt) : 'Never']);
        facts.push(['Status', key.status === 'invalid' && key.statusDetail ? `Invalid — ${key.statusDetail}` : statusText(key)]);
        if (key.lastError) {
            facts.push(['Last error', `${key.lastError}${key.lastErrorAt ? ` (${formatAgo(key.lastErrorAt)})` : ''}`]);
        }

        const details = h(
            'div',
            { class: 'key-details' },
            h('dl', { class: 'facts' }, ...facts.flatMap(([label, value]) => [h('dt', { text: label }), h('dd', { text: value })])),
            h('div', { class: 'subhead', text: 'Usage' }),
            usageTable([
                ['Today', key.today],
                ['This window', key.window],
                ['Last 30 days', key.month],
            ]),
            h('div', { class: 'subhead', text: 'Provider quota' }),
        );

        if (!key.quota) {
            details.append(h('p', { class: 'muted small', text: 'Appears after the first request made with this key.' }));
        } else if (!key.quota.windows.length) {
            details.append(h('p', { class: 'muted small', text: `${key.providerLabel} doesn't report its limits, so only local usage is tracked for this key.` }));
        } else {
            details.append(...key.quota.windows.map((w) => quotaBar(w, false)), h('p', { class: 'muted small', text: `Reported by ${key.providerLabel} ${formatAgo(key.quota.capturedAt)}.` }));
        }

        const test = this.testResults.get(key.id);
        if (test) {
            details.append(h('div', { class: `inline-result ${test.ok ? 'ok' : 'bad'}` }, icon(test.ok ? 'check' : 'alert'), h('span', { text: test.message })));
        }

        if (this.renaming.has(key.id)) {
            const input = h('input', { class: 'input', attrs: { type: 'text', value: key.label, maxlength: '40' } });
            const save = () => {
                this.renaming.delete(key.id);
                if (input.value.trim() && input.value.trim() !== key.label) {
                    send({ type: 'renameKey', id: key.id, label: input.value.trim() });
                }
                this.renderKeys();
            };
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    save();
                } else if (event.key === 'Escape') {
                    this.renaming.delete(key.id);
                    this.renderKeys();
                }
            });
            details.append(h('div', { class: 'rename-row' }, input, button('Save', 'primary small', save)));
            requestAnimationFrame(() => input.select());
        }

        const testButton = button(
            this.testing.has(key.id) ? 'Testing…' : 'Test',
            'secondary small',
            () => {
                this.testing.add(key.id);
                this.testResults.delete(key.id);
                send({ type: 'testKey', id: key.id });
                this.renderKeys();
            },
            'refresh',
            'Check this key with the provider',
        );
        testButton.disabled = this.testing.has(key.id);
        const managed = key.source === 'extension';
        details.append(
            h(
                'div',
                { class: 'key-actions' },
                testButton,
                managed
                    ? button(
                          'Rename',
                          'secondary small',
                          () => {
                              this.renaming.add(key.id);
                              this.renderKeys();
                          },
                          'pencil',
                      )
                    : null,
                button(key.enabled ? 'Disable' : 'Enable', 'secondary small', () => send({ type: 'toggleKey', id: key.id, enabled: !key.enabled })),
                managed ? button('Remove', 'danger small', () => send({ type: 'removeKey', id: key.id }), 'trash') : null,
            ),
        );
        if (!managed) {
            details.append(h('p', { class: 'muted small', text: `Set outside FreeAgentCoder (${key.sourceDetail ?? 'external'}). Remove it there, or disable it here.` }));
        }
        return details;
    }

    private renderUsage(): void {
        const data = this.data;
        if (!data) {
            return;
        }
        const usage = data.usage;
        const tile = (label: string, counts: UsageCounts) =>
            h(
                'div',
                { class: 'tile' },
                h('div', { class: 'tile-label', text: label }),
                h('div', { class: 'tile-value', text: compactNumber(tokens(counts)) }),
                h('div', { class: 'tile-sub', text: `${fullNumber(counts.requests)} requests` }),
            );

        const suggestions = data.suggestions.map((s) => suggestionCard(s, (provider) => this.openAddKey(provider)));

        const capacity = data.capacity
            .filter((c) => c.usableKeys > 0)
            .map((c) =>
                h(
                    'div',
                    { class: 'capacity-card' },
                    h(
                        'div',
                        { class: 'capacity-head' },
                        h('strong', { text: `${c.label} · ${c.usableKeys} key${c.usableKeys === 1 ? '' : 's'}` }),
                        h('span', {
                            class: 'muted',
                            text: `Today: ${compactNumber(tokens(c.today))} tokens · ${fullNumber(c.today.requests)} requests${
                                c.rateLimitsToday ? ` · rate-limited ${c.rateLimitsToday} time${c.rateLimitsToday === 1 ? '' : 's'}` : ''
                            }`,
                        }),
                    ),
                    ...(c.windows.length
                        ? c.windows.map((w) => capacityBar(w, c.usableKeys))
                        : [h('p', { class: 'muted small', text: `${c.label} doesn't report its limits, so only your usage is shown.` })]),
                ),
            );

        const max = Math.max(1, ...usage.days.map((d) => d.tokens));
        const bars = h(
            'div',
            { class: 'bars' },
            ...usage.days.map((day) => {
                const fill = h('div', { class: 'bars-fill' });
                fill.style.height = `${(day.tokens / max) * 100}%`;
                const weekday = new Date(`${day.day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
                return h(
                    'div',
                    { class: 'bars-col', title: `${day.day}: ${fullNumber(day.tokens)} tokens, ${fullNumber(day.requests)} requests` },
                    h('div', { class: 'bars-track' }, fill),
                    h('span', { class: 'bars-label', text: weekday }),
                );
            }),
        );

        const active = data.keys.filter((k) => k.month.requests > 0).sort((a, b) => tokens(b.today) - tokens(a.today) || tokens(b.month) - tokens(a.month));
        const topToday = Math.max(1, ...active.map((k) => tokens(k.today)));
        const byKey = active.map((key) =>
            h(
                'div',
                { class: 'key-share' },
                h(
                    'div',
                    { class: 'key-share-line' },
                    h('span', { text: `${key.providerLabel} · ${key.label}` }),
                    h('span', { class: 'muted', text: `${compactNumber(tokens(key.today))} today · ${fullNumber(key.today.requests)} req` }),
                ),
                bar(tokens(key.today) / topToday),
            ),
        );

        this.sections.usage.content.replaceChildren(
            ...(suggestions.length ? [h('div', { class: 'subhead', text: 'Suggestions' }), ...suggestions] : []),
            ...data.warnings.map((w) => h('div', { class: 'callout warn' }, icon('alert'), h('span', { text: w }))),
            h('div', { class: 'tiles' }, tile('Today', usage.today), tile('This window', usage.window), tile('Last 30 days', usage.month)),
            h('div', {
                class: 'split',
                text: `Today: ${compactNumber(usage.today.inputTokens)} input · ${compactNumber(usage.today.outputTokens)} output${
                    usage.today.errors ? ` · ${usage.today.errors} failed requests` : ''
                }`,
            }),
            ...(capacity.length ? [h('div', { class: 'subhead', text: 'Limits across your keys' }), ...capacity] : []),
            h('div', { class: 'subhead', text: 'Last 7 days' }),
            bars,
            ...(byKey.length ? [h('div', { class: 'subhead', text: 'By key' }), ...byKey] : []),
            h(
                'div',
                { class: 'callout' },
                icon('info'),
                h('span', {
                    text: "Limits come only from what providers report in their responses (Groq, Cerebras, Mistral, OpenRouter, OpenAI and Anthropic do). Gemini doesn't, so Gemini shows your usage without a limit.",
                }),
            ),
        );
    }

    private renderHistory(): void {
        const state = this.historyState;
        const content = this.sections.history.content;
        if (!state) {
            content.replaceChildren(h('p', { class: 'muted small', text: 'Loading saved chats…' }));
            return;
        }
        const on = state.mode === 'on';
        const parts: HTMLElement[] = [
            switchRow('Save chat history', on, "Chats are kept only on this computer, in VS Code's storage for this extension. Nothing is uploaded.", (value) =>
                send({ type: 'setHistoryMode', mode: value ? 'on' : 'off' }),
            ),
        ];
        if (state.mode === 'ask') {
            parts.push(h('div', { class: 'callout' }, icon('info'), h('span', { text: "You haven't chosen yet. Turn this on to keep your chats, or you'll be asked after your next conversation." })));
        }
        if (state.chats.length) {
            parts.push(this.historySearch, this.historyList, button('Delete all history', 'danger small', () => send({ type: 'clearHistory' }), 'trash'));
        } else {
            parts.push(
                h(
                    'div',
                    { class: 'empty-card' },
                    icon('history'),
                    h('strong', { text: on ? 'No saved chats yet' : 'History is off' }),
                    h('span', { text: on ? 'Each chat is saved here after every reply.' : 'Turn on "Save chat history" to keep your conversations.' }),
                ),
            );
        }
        content.replaceChildren(...parts);
        this.renderHistoryList();
    }

    private renderHistoryList(): void {
        const state = this.historyState;
        if (!state) {
            return;
        }
        const query = this.historySearch.value.trim().toLowerCase();
        const chats = state.chats.filter((c) => !query || c.title.toLowerCase().includes(query) || (c.workspace ?? '').toLowerCase().includes(query));
        if (!chats.length) {
            this.historyList.replaceChildren(h('p', { class: 'muted small', text: query ? 'No chats match your search.' : '' }));
            return;
        }
        const now = Date.now();
        const nodes: HTMLElement[] = [];
        let group = '';
        for (const chat of chats) {
            const label = groupLabel(chat.updatedAt, now);
            if (label !== group) {
                group = label;
                nodes.push(h('div', { class: 'history-group-title', text: label }));
            }
            const current = chat.id === state.currentId;
            const open = h(
                'button',
                { class: 'history-open', title: current ? 'This chat is open' : 'Open this chat', attrs: { type: 'button' } },
                h('span', { class: 'history-title', text: chat.title || 'Untitled chat' }),
                h('span', {
                    class: 'history-meta',
                    text: [chat.workspace, `${chat.turns} prompt${chat.turns === 1 ? '' : 's'}`, formatAgo(chat.updatedAt)].filter(Boolean).join(' · '),
                }),
            );
            open.addEventListener('click', () => send({ type: 'openChat', id: chat.id }));
            nodes.push(
                h(
                    'div',
                    { class: `history-row${current ? ' current' : ''}` },
                    open,
                    current ? h('span', { class: 'tag', text: 'OPEN' }) : null,
                    iconButton('trash', 'Delete this chat', () => send({ type: 'deleteChat', id: chat.id })),
                ),
            );
        }
        this.historyList.replaceChildren(...nodes);
    }

    private renderLogs(): void {
        const state = this.logsState;
        const content = this.sections.logs.content;
        if (!state) {
            content.replaceChildren(h('p', { class: 'muted small', text: 'Loading…' }));
            return;
        }
        const { stats } = state;
        const tile = (label: string, value: number, sub: string) =>
            h('div', { class: 'tile' }, h('div', { class: 'tile-label', text: label }), h('div', { class: 'tile-value', text: fullNumber(value) }), h('div', { class: 'tile-sub', text: sub }));
        const filterNames: Record<'all' | LogKind, string> = { all: 'All', provider: 'Providers', agent: 'Tasks', extension: 'Extension' };
        const filters = h(
            'div',
            { class: 'filter-row' },
            ...(Object.keys(filterNames) as ('all' | LogKind)[]).map((kind) => {
                const chip = h('button', { class: `nav-chip${this.logFilter === kind ? ' active' : ''}`, text: filterNames[kind], attrs: { type: 'button' } });
                chip.addEventListener('click', () => {
                    this.logFilter = kind;
                    this.renderLogs();
                });
                return chip;
            }),
        );
        const entries = state.entries.filter((e) => this.logFilter === 'all' || e.kind === this.logFilter);

        content.replaceChildren(
            h('div', { class: 'tiles' }, tile('Today', stats.today, 'errors'), tile('Handled', stats.handled, 'recovered automatically'), tile('Need attention', stats.unresolved, 'not recovered')),
            ...(stats.topSources.length
                ? [
                      h('div', { class: 'subhead', text: 'Most frequent today' }),
                      ...stats.topSources.map((s) => h('div', { class: 'source-row' }, h('span', { text: s.source }), h('span', { class: 'muted', text: `×${s.count}` }))),
                  ]
                : []),
            h('div', { class: 'subhead', text: 'Recent' }),
            filters,
            entries.length
                ? h('div', { class: 'log-list' }, ...entries.slice(0, 100).map(logRow))
                : h('div', { class: 'empty-card' }, icon('check'), h('strong', { text: 'Nothing logged' }), h('span', { text: 'Errors and how they were handled will show up here.' })),
            h(
                'div',
                { class: 'key-actions' },
                button('Copy diagnostics', 'secondary small', () => send({ type: 'copyDiagnostics' }), 'copy', 'Copy a report with no API keys, to share when you ask for help'),
                state.entries.length ? button('Clear log', 'danger small', () => send({ type: 'clearLogs' }), 'trash') : null,
            ),
            h('div', { class: 'callout' }, icon('shield'), h('span', { text: 'Logs stay on this computer. API keys are never recorded, and anything that looks like a key is redacted.' })),
        );
    }

    private renderOverview(): void {
        const data = this.data;
        if (!data) {
            return;
        }
        const overview = data.overview;
        const left = overview.promptsLeft;
        const stats = overview.efficiency;
        const today = data.usage.today;
        const tile = (label: string, value: string, sub: string, primary = false) =>
            h('div', { class: `tile${primary ? ' primary' : ''}` }, h('div', { class: 'tile-label', text: label }), h('div', { class: 'tile-value', text: value }), h('div', { class: 'tile-sub', text: sub }));

        const parts: HTMLElement[] = [
            h(
                'div',
                { class: 'tiles' },
                tile(
                    'Prompts left today',
                    left.value === undefined ? '—' : left.atLeast ? `${fullNumber(left.value)}+` : `≈${fullNumber(left.value)}`,
                    left.value === undefined ? 'limits not reported yet' : `~${left.requestsPerPrompt} requests each`,
                    true,
                ),
                tile('Tokens today', compactNumber(tokens(today)), `${fullNumber(today.requests)} requests`),
                tile('Active keys', fullNumber(data.usableKeys), `of ${fullNumber(data.keys.length)} added`),
            ),
            h('div', { class: 'callout' }, icon('info'), h('span', { text: left.basis })),
            ...data.suggestions.filter((s) => s.level === 'warn').slice(0, 2).map((s) => suggestionCard(s, (provider) => this.openAddKey(provider))),
            h('div', { class: 'subhead', text: 'This project' }),
        ];

        const project = overview.project;
        if (project) {
            const facts = [
                project.git ? 'Git repository' : 'Not a Git repository',
                project.indexedFiles ? `${fullNumber(project.indexedFiles)} files indexed for code search` : 'Code index builds on the first complex task',
                project.instructionsFile ? `Follows ${project.instructionsFile}` : 'No AGENTS.md or similar instructions file',
                `${overview.lessons.length} lesson${overview.lessons.length === 1 ? '' : 's'} in memory`,
            ];
            parts.push(
                h(
                    'div',
                    { class: 'project-card' },
                    h('div', { class: 'project-name' }, icon('folder'), h('span', { text: project.name })),
                    project.stack.length
                        ? h('div', { class: 'stack-list' }, ...project.stack.map((name) => h('span', { class: 'tag', text: name })))
                        : h('span', { class: 'muted small', text: 'Stack not detected from the files in the project root.' }),
                    h('div', { class: 'fact-line' }, ...facts.map((fact) => h('span', { text: fact }))),
                ),
            );
        } else {
            parts.push(h('p', { class: 'muted small', text: 'Open a folder to see its status.' }));
        }

        parts.push(h('div', { class: 'subhead', text: 'Last 7 days' }));
        parts.push(
            stats.tasks
                ? h(
                      'div',
                      { class: 'tiles' },
                      tile('Tasks', fullNumber(stats.tasks), `${Math.round((stats.completed / stats.tasks) * 100)}% completed`),
                      tile('Per task', formatDuration(stats.avgDurationMs), `${compactNumber(stats.avgTokens)} tokens · ${fullNumber(stats.avgRequests)} requests`),
                      tile('Auto-recovered', fullNumber(stats.recoveries), 'problems handled without stopping'),
                  )
                : h('p', { class: 'muted small', text: 'Stats appear after your first task.' }),
        );

        parts.push(
            h('div', { class: 'subhead', text: 'Features' }),
            h(
                'div',
                { class: 'feature-list' },
                ...overview.features.map((feature) => switchRow(feature.label, feature.on, feature.description, (on) => send({ type: 'setFeature', id: feature.id, on }))),
            ),
            trustCard(),
        );
        this.sections.overview.content.replaceChildren(...parts);
    }

    private renderMemory(): void {
        const data = this.data;
        if (!data) {
            return;
        }
        const overview = data.overview;
        const learning = overview.features.find((f) => f.id === 'learning');
        const lessonItem = (lesson: LessonView) =>
            h(
                'div',
                { class: 'lesson-item' },
                icon(lesson.source === 'user' ? 'pencil' : 'brain'),
                h(
                    'div',
                    { class: 'lesson-main' },
                    h('div', { text: lesson.text }),
                    h('div', { class: 'lesson-meta', text: `${lesson.source === 'user' ? 'Added by you' : 'Learned from a correction'} · ${formatAgo(lesson.createdAt)}` }),
                ),
                iconButton('trash', 'Delete this lesson', () => send({ type: 'deleteLesson', id: lesson.id })),
            );
        const group = (title: string, lessons: LessonView[], empty: string) => [
            h('div', { class: 'subhead', text: title }),
            lessons.length ? h('div', { class: 'lesson-list' }, ...lessons.map(lessonItem)) : h('p', { class: 'muted small', text: empty }),
        ];

        this.sections.memory.content.replaceChildren(
            ...(learning ? [switchRow(learning.label, learning.on, learning.description, (on) => send({ type: 'setFeature', id: 'learning', on }))] : []),
            h('div', { class: 'subhead', text: 'Teach it something' }),
            h('div', { class: 'lesson-add' }, this.lessonInput, this.lessonScope, button('Save', 'primary small', () => this.saveLesson(), 'check')),
            h('p', { class: 'muted small', text: 'You can also type "remember that …" in the chat.' }),
            ...group(
                overview.project ? `This project · ${overview.project.name}` : 'This project',
                overview.lessons.filter((l) => l.scope === 'project'),
                'No lessons for this project yet. Point out a fix in the chat, or add one above.',
            ),
            ...group('All projects', overview.lessons.filter((l) => l.scope === 'global'), 'No lessons that apply everywhere yet.'),
            h(
                'div',
                { class: 'callout' },
                icon('lock'),
                h('span', { text: 'Lessons stay on this computer and are added to future tasks as plain instructions. They never train or change the AI models themselves.' }),
            ),
        );
    }

    private saveLesson(): void {
        const text = this.lessonInput.value.trim();
        if (!text) {
            this.lessonInput.focus();
            return;
        }
        send({ type: 'addLesson', text, scope: this.lessonScope.value === 'global' ? 'global' : 'project' });
        this.lessonInput.value = '';
    }

    private renderModel(): void {
        const data = this.data;
        if (!data) {
            return;
        }
        const content = this.sections.model.content;
        const isAuto = data.model === 'auto';
        const withKeys = new Set(data.keys.filter((k) => k.enabled && k.status !== 'invalid').map((k) => k.provider));
        const colon = data.model.indexOf(':');
        const selectedProvider = isAuto ? undefined : data.model.slice(0, colon);
        const selectedModel = isAuto ? undefined : data.model.slice(colon + 1);

        let picker: HTMLElement | null = null;
        if (!isAuto && selectedProvider) {
            const providerSelect = h('select', { class: 'input' });
            for (const p of data.providers) {
                const option = h('option', { text: `${p.label}${withKeys.has(p.id) ? '' : ' (no key)'}`, attrs: { value: p.id } });
                option.selected = p.id === selectedProvider;
                providerSelect.append(option);
            }
            const provider = data.providers.find((p) => p.id === selectedProvider);
            const models = [...new Set([...(provider?.models ?? []), selectedModel ?? ''])].filter(Boolean);
            const modelSelect = h('select', { class: 'input' });
            for (const m of models) {
                const option = h('option', { text: m, attrs: { value: m } });
                option.selected = m === selectedModel;
                modelSelect.append(option);
            }
            providerSelect.addEventListener('change', () => {
                const next = data.providers.find((p) => p.id === providerSelect.value);
                if (next) {
                    send({ type: 'setModel', model: `${next.id}:${next.defaultModel}` });
                }
            });
            modelSelect.addEventListener('change', () => send({ type: 'setModel', model: `${selectedProvider}:${modelSelect.value}` }));
            picker = h('div', { class: 'field-row' }, field('Provider', providerSelect), field('Model', modelSelect));
        }

        const routes = data.routes.map((route) =>
            h(
                'div',
                { class: 'route' },
                h('div', { class: 'route-title' }, h('strong', { text: route.title }), h('span', { class: 'muted', text: route.description })),
                route.steps.length
                    ? h('ol', { class: 'route-steps' }, ...route.steps.map((step) => h('li', { text: step })))
                    : h('p', { class: 'muted small', text: 'No active key can serve this route yet.' }),
            ),
        );

        content.replaceChildren(
            radioCard(
                isAuto,
                'spark',
                'Auto — smart routing',
                'Recommended. Quick questions and small edits go to the fastest model; building, debugging and multi-file work go to the strongest. When a key hits its limit, the next one takes over.',
                () => send({ type: 'setModel', model: 'auto' }),
            ),
            radioCard(
                !isAuto,
                'layers',
                'Specific model',
                'Always start with one model. Your other free keys still take over if it fails.',
                () => {
                    if (isAuto) {
                        const first = data.providers.find((p) => withKeys.has(p.id)) ?? data.providers[0];
                        send({ type: 'setModel', model: `${first.id}:${first.defaultModel}` });
                    }
                },
                picker,
            ),
            h('div', { class: 'subhead', text: 'Routing order with your keys' }),
            ...routes,
        );
    }

    private renderPermissions(): void {
        const data = this.data;
        if (!data) {
            return;
        }
        const modes: [PermissionMode, IconName, string, string][] = [
            ['ask', 'shield', 'Manual', 'Reads files freely. Asks before every file change, command and web request.'],
            ['auto-edit', 'pencil', 'Auto-edit', 'Changes files automatically. Still asks before running commands or fetching web pages.'],
            ['auto', 'bolt', 'Auto', 'Changes files and runs commands automatically. Always asks before risky commands (deleting files, git push, deploys, system-wide installs) and anything outside this folder.'],
        ];
        this.sections.permissions.content.replaceChildren(
            ...modes.map(([mode, iconName, title, description]) => radioCard(data.mode === mode, iconName, title, description, () => send({ type: 'setMode', mode }))),
            h(
                'div',
                { class: 'callout' },
                icon('info'),
                h('span', { text: 'Commands that could wreck a disk or delete everything are always blocked, in every mode. Undo is available after each task that changes files.' }),
            ),
        );
    }
}
