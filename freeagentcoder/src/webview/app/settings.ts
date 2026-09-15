import { compactNumber, formatAgo, formatDate, formatDuration, fullNumber } from '../../shared/format';
import type { KeyView, PermissionMode, ProviderView, QuotaWindow, SettingsSection, SettingsView, ToWebview, UsageCounts } from '../../shared/protocol';
import { button, h, handleContentClick, iconButton, send } from './dom';
import { icon, type IconName } from './icons';

type Msg<T extends ToWebview['type']> = Extract<ToWebview, { type: T }>;

const SECTION_LABELS: Record<SettingsSection, string> = { keys: 'API Keys', usage: 'Usage', model: 'Model', permissions: 'Permissions' };

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

function quotaBar(window: QuotaWindow, compact: boolean): HTMLElement {
    const fraction = window.remaining / window.limit;
    const tone = fraction <= 0.1 ? 'bad' : fraction <= 0.3 ? 'warn' : 'ok';
    const fill = h('div', { class: 'bar-fill' });
    fill.style.width = `${Math.max(2, Math.min(100, fraction * 100))}%`;
    const now = Date.now();
    const reset = window.resetAt ? (window.resetAt > now ? `resets in ${formatDuration(window.resetAt - now)}` : 'has reset since') : '';
    const name = `${window.dimension[0].toUpperCase()}${window.dimension.slice(1)}${window.period ? ` per ${window.period}` : ''}`;
    return h(
        'div',
        { class: `quota ${tone}${compact ? ' compact' : ''}` },
        h(
            'div',
            { class: 'quota-line' },
            h('span', { text: name }),
            h('span', { class: 'muted', text: `${compactNumber(window.remaining)} of ${compactNumber(window.limit)} left${reset ? ` · ${reset}` : ''}` }),
        ),
        h('div', { class: 'bar' }, fill),
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

function section(id: SettingsSection, description: string, ...children: HTMLElement[]): { el: HTMLElement; content: HTMLElement } {
    const content = h('div', { class: 'section-content' }, ...children);
    const el = h('section', { class: 'settings-section', attrs: { id: `section-${id}` } }, h('h2', { text: SECTION_LABELS[id] }), h('p', { class: 'section-desc', text: description }), content);
    return { el, content };
}

class AddKeyForm {
    readonly el = h('div', { class: 'card add-key', hidden: true });
    private readonly provider = h('select', { class: 'input' });
    private readonly note = h('p', {});
    private readonly getKey = h('a', { class: 'link', text: 'Get a free key ↗', attrs: { href: '#' } });
    private readonly name = h('input', { class: 'input', attrs: { type: 'text', placeholder: 'e.g. Personal, College, Work', maxlength: '40' } });
    private readonly secret = h('input', { class: 'input mono', attrs: { type: 'password', placeholder: 'Paste your API key', autocomplete: 'off', spellcheck: 'false' } });
    private readonly error = h('div', { class: 'inline-result bad', hidden: true });
    private readonly reveal: HTMLButtonElement;
    private readonly save: HTMLButtonElement;
    private providers: ProviderView[] = [];
    private requestId?: string;

    constructor() {
        this.reveal = iconButton('eye', 'Show or hide the key', () => {
            const show = this.secret.type === 'password';
            this.secret.type = show ? 'text' : 'password';
            this.reveal.replaceChildren(icon(show ? 'eyeOff' : 'eye'));
        });
        this.save = button('Save key', 'primary', () => this.submit(), 'check');
        this.provider.addEventListener('change', () => this.describe());
        this.secret.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                this.submit();
            }
        });
        this.getKey.addEventListener('click', (event) => {
            event.preventDefault();
            const url = this.current()?.signupUrl;
            if (url) {
                send({ type: 'openExternal', url });
            }
        });
        this.el.append(
            h('div', { class: 'card-head' }, icon('key'), h('span', { class: 'card-title', text: 'Add API key' })),
            h(
                'div',
                { class: 'card-body form' },
                field('Provider', this.provider),
                h('div', { class: 'provider-note' }, this.note, this.getKey),
                field('Name', this.name, 'So you can tell your keys apart.'),
                field('API key', h('div', { class: 'secret-field' }, this.secret, this.reveal), 'Checked with the provider, then encrypted in VS Code Secret Storage.'),
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
        }
        this.describe();
        this.error.hidden = true;
        (providerId ? this.name : this.provider).focus();
        this.el.scrollIntoView({ block: 'nearest' });
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
    }

    private current(): ProviderView | undefined {
        return this.providers.find((p) => p.id === this.provider.value);
    }

    private describe(): void {
        const provider = this.current();
        this.note.textContent = provider?.note ?? '';
        this.getKey.hidden = !provider?.signupUrl;
        this.getKey.textContent = provider?.free ? 'Get a free key ↗' : 'Get a key ↗';
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
    private readonly scroller = h('div', { class: 'settings-scroll' });
    private readonly form = new AddKeyForm();
    private readonly keySummary = h('div', { class: 'key-summary' });
    private readonly keyGroups = h('div', { class: 'key-groups' });
    private readonly sections: Record<SettingsSection, { el: HTMLElement; content: HTMLElement }>;
    private readonly expanded = new Set<string>();
    private readonly renaming = new Set<string>();
    private readonly testing = new Set<string>();
    private readonly testResults = new Map<string, { ok: boolean; message: string }>();
    private data?: SettingsView;

    constructor(private readonly options: { close: () => void; toast: (message: string, level: 'info' | 'error') => void }) {
        this.sections = {
            keys: section(
                'keys',
                'Add several keys per provider: when one hits its limit, the next takes over. Keys are encrypted in VS Code Secret Storage and never shown again.',
                this.keySummary,
                button('Add API key', 'primary block', () => this.form.open(), 'plus'),
                this.form.el,
                this.keyGroups,
            ),
            usage: section('usage', 'Counted on this machine from every provider response.'),
            model: section('model', 'How each request picks a model.'),
            permissions: section('permissions', 'What FreeAgentCoder may do without asking first.'),
        };
        const nav = h('nav', { class: 'settings-nav' });
        for (const id of Object.keys(SECTION_LABELS) as SettingsSection[]) {
            const chip = h('button', { class: 'nav-chip', text: SECTION_LABELS[id], attrs: { type: 'button' } });
            chip.addEventListener('click', () => this.sections[id].el.scrollIntoView({ block: 'start', behavior: 'smooth' }));
            nav.append(chip);
        }
        this.scroller.append(...Object.values(this.sections).map((s) => s.el));
        this.scroller.addEventListener('click', handleContentClick);
        this.el.append(
            h('div', { class: 'settings-header' }, iconButton('back', 'Back to chat', options.close), h('span', { class: 'settings-title', text: 'Settings' })),
            nav,
            this.scroller,
        );
    }

    update(data: SettingsView): void {
        this.data = data;
        this.form.setProviders(data.providers);
        this.renderKeys();
        this.renderUsage();
        this.renderModel();
        this.renderPermissions();
    }

    show(target?: SettingsSection): void {
        requestAnimationFrame(() => {
            if (target) {
                this.sections[target].el.scrollIntoView({ block: 'start' });
            } else {
                this.scroller.scrollTop = 0;
            }
            if (target === 'keys' && this.data && !this.data.keys.length) {
                this.form.open();
            }
        });
    }

    keyResult(message: Msg<'keyResult'>): void {
        if (this.form.result(message)) {
            this.options.toast(message.message, 'info');
        }
    }

    keyTest(message: Msg<'keyTest'>): void {
        this.testing.delete(message.id);
        this.testResults.set(message.id, { ok: message.ok, message: message.message });
        this.expanded.add(message.id);
        this.renderKeys();
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
                    ...missing.map((p) => {
                        const link = h('a', { class: 'link', text: 'Get key ↗', attrs: { href: p.signupUrl, 'data-external': '1' } });
                        return h(
                            'div',
                            { class: 'available-row' },
                            h('div', { class: 'available-text' }, h('strong', { text: p.label }), h('span', { class: 'muted', text: p.note, title: p.note })),
                            link,
                            button('Add', 'secondary small', () => this.form.open(p.id)),
                        );
                    }),
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

        const testButton = button(this.testing.has(key.id) ? 'Testing…' : 'Test', 'secondary small', () => {
            this.testing.add(key.id);
            this.testResults.delete(key.id);
            send({ type: 'testKey', id: key.id });
            this.renderKeys();
        }, 'refresh', 'Check this key with the provider');
        testButton.disabled = this.testing.has(key.id);
        const managed = key.source === 'extension';
        details.append(
            h(
                'div',
                { class: 'key-actions' },
                testButton,
                managed
                    ? button('Rename', 'secondary small', () => {
                          this.renaming.add(key.id);
                          this.renderKeys();
                      }, 'pencil')
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
        const content = this.sections.usage.content;
        const tile = (label: string, counts: UsageCounts) =>
            h('div', { class: 'tile' }, h('div', { class: 'tile-label', text: label }), h('div', { class: 'tile-value', text: compactNumber(tokens(counts)) }), h('div', { class: 'tile-sub', text: `${fullNumber(counts.requests)} requests` }));

        const warnings = data.warnings.map((w) => h('div', { class: 'callout warn' }, icon('alert'), h('span', { text: w })));
        const max = Math.max(1, ...usage.days.map((d) => d.tokens));
        const bars = h(
            'div',
            { class: 'bars' },
            ...usage.days.map((day) => {
                const fill = h('div', { class: 'bars-fill' });
                fill.style.height = `${(day.tokens / max) * 100}%`;
                const weekday = new Date(`${day.day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
                return h('div', { class: 'bars-col', title: `${day.day}: ${fullNumber(day.tokens)} tokens, ${fullNumber(day.requests)} requests` }, h('div', { class: 'bars-track' }, fill), h('span', { class: 'bars-label', text: weekday }));
            }),
        );

        const active = data.keys.filter((k) => k.month.requests > 0).sort((a, b) => tokens(b.today) - tokens(a.today) || tokens(b.month) - tokens(a.month));
        const topToday = Math.max(1, ...active.map((k) => tokens(k.today)));
        const byKey = active.map((key) => {
            const fill = h('div', { class: 'bar-fill' });
            fill.style.width = `${(tokens(key.today) / topToday) * 100}%`;
            return h(
                'div',
                { class: 'key-share' },
                h(
                    'div',
                    { class: 'key-share-line' },
                    h('span', { text: `${key.providerLabel} · ${key.label}` }),
                    h('span', { class: 'muted', text: `${compactNumber(tokens(key.today))} today · ${fullNumber(key.today.requests)} req` }),
                ),
                h('div', { class: 'bar' }, fill),
            );
        });

        content.replaceChildren(
            ...warnings,
            h('div', { class: 'tiles' }, tile('Today', usage.today), tile('This window', usage.window), tile('Last 30 days', usage.month)),
            h('div', {
                class: 'split',
                text: `Today: ${compactNumber(usage.today.inputTokens)} input · ${compactNumber(usage.today.outputTokens)} output${usage.today.errors ? ` · ${usage.today.errors} failed requests` : ''}`,
            }),
            h('div', { class: 'subhead', text: 'Last 7 days' }),
            bars,
            ...(byKey.length ? [h('div', { class: 'subhead', text: 'By key' }), ...byKey] : []),
            h(
                'div',
                { class: 'callout' },
                icon('info'),
                h('span', {
                    text: "Quota bars show only the limits providers report in their responses (Groq, Cerebras, Mistral, OpenRouter, OpenAI and Anthropic do). Gemini doesn't, so Gemini keys show local usage only.",
                }),
            ),
        );
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
            ['auto', 'bolt', 'Auto', 'Changes files and runs commands automatically. Always asks before risky commands (deleting files, git push, deploys) and anything outside this folder.'],
        ];
        this.sections.permissions.content.replaceChildren(
            ...modes.map(([mode, iconName, title, description]) => radioCard(data.mode === mode, iconName, title, description, () => send({ type: 'setMode', mode }))),
            h('div', { class: 'callout' }, icon('info'), h('span', { text: 'Commands that could wreck a disk or delete everything are always blocked, in every mode. Undo is available after each task that changes files.' })),
        );
    }
}
