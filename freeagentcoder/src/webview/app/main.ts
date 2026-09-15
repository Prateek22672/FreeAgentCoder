import './styles.css';
import { compactNumber } from '../../shared/format';
import type { PermissionMode, SettingsSection, SettingsView, ToWebview } from '../../shared/protocol';
import { button, fill, h, iconButton, send } from './dom';
import { icon, type IconName } from './icons';
import { SettingsPanel } from './settings';
import { Transcript } from './transcript';

const MODES: Record<PermissionMode, { label: string; icon: IconName; description: string }> = {
    ask: { label: 'Manual', icon: 'shield', description: 'Ask before edits, commands and web requests' },
    'auto-edit': { label: 'Auto-edit', icon: 'pencil', description: 'Edit files freely; ask before commands' },
    auto: { label: 'Auto', icon: 'bolt', description: 'Edit and run commands; ask only for risky ones' },
};

const SUGGESTIONS = [
    'Explain how this project is structured',
    'Find and fix bugs in the current code',
    'Add tests for the main module and run them',
    'Build a responsive landing page with React and Tailwind',
];

type MenuItem =
    | { kind: 'header'; label: string }
    | { kind: 'item'; label: string; description?: string; icon?: IconName; selected?: boolean; run: () => void };

let settings: SettingsView | undefined;
let running = false;
let hasWorkspace = true;
let lastPrompt = '';
let usage = { sessionTokens: 0, contextTokens: 0, contextLimit: 0 };

const app = document.getElementById('app') as HTMLElement;

const header = h(
    'header',
    { class: 'app-header' },
    h('div', { class: 'brand' }, icon('mark', 'brand-mark'), h('span', { text: 'FreeAgentCoder' })),
    h('div', { class: 'header-actions' }, iconButton('plus', 'New chat', () => send({ type: 'newChat' })), iconButton('gear', 'Settings', () => openSettings())),
);
const banner = h('button', { class: 'banner', hidden: true, attrs: { type: 'button' } });
banner.addEventListener('click', () => openSettings(settings?.usableKeys ? 'usage' : 'keys'));

const welcome = h('div', { class: 'welcome' });
const list = h('div', { class: 'transcript' });
const scroller = h('main', { class: 'scroller' }, welcome, list);
const transcript = new Transcript(scroller, list, () => updateEmpty());

const input = h('textarea', { class: 'composer-input', attrs: { rows: '1', placeholder: 'Ask FreeAgentCoder to build, fix or explain…' } });
const modeButton = h('button', { class: 'pill', attrs: { type: 'button' } });
const modelButton = h('button', { class: 'pill', attrs: { type: 'button' } });
const sendButton = h('button', { class: 'send-btn', attrs: { type: 'button' } });
const menu = h('div', { class: 'menu', hidden: true });
const composer = h('div', { class: 'composer' }, menu, input, h('div', { class: 'composer-bar' }, modeButton, modelButton, h('span', { class: 'spacer' }), sendButton));
const foot = h('div', { class: 'composer-foot' });
const toast = h('div', { class: 'toast', hidden: true, attrs: { role: 'status' } });

const settingsPanel = new SettingsPanel({ close: closeSettings, toast: showToast });
app.append(h('div', { class: 'chat' }, header, banner, scroller, h('div', { class: 'composer-wrap' }, composer, foot)), settingsPanel.el, toast);

function openSettings(section?: SettingsSection): void {
    closeMenu();
    app.classList.add('show-settings');
    settingsPanel.show(section);
}

function closeSettings(): void {
    app.classList.remove('show-settings');
    input.focus();
}

function modelName(ref: string): string {
    const colon = ref.indexOf(':');
    return colon > 0 ? (ref.slice(colon + 1).split('/').pop() ?? ref) : ref;
}

function renderWelcome(): void {
    const needsKey = settings !== undefined && settings.usableKeys === 0;
    fill(
        welcome,
        h('div', { class: 'welcome-mark' }, icon('mark')),
        h('h1', { text: 'FreeAgentCoder' }),
        h('p', { class: 'welcome-sub', text: 'Plans, writes, runs and verifies code in your project using free AI models.' }),
        !hasWorkspace
            ? h(
                  'div',
                  { class: 'card setup' },
                  h('div', { class: 'card-head' }, icon('folder'), h('span', { class: 'card-title', text: 'Open a project folder' })),
                  h('div', { class: 'card-body' }, h('p', { class: 'muted', text: 'FreeAgentCoder works inside a folder so it can read, create and run files.' }), button('Open Folder', 'primary small', () => send({ type: 'openFolder' }), 'folder')),
              )
            : null,
        needsKey
            ? h(
                  'div',
                  { class: 'card setup' },
                  h('div', { class: 'card-head' }, icon('key'), h('span', { class: 'card-title', text: 'Add your first API key' })),
                  h(
                      'div',
                      { class: 'card-body' },
                      h('p', { class: 'muted', text: 'Gemini, Groq and Cerebras have free tiers. Add several keys and FreeAgentCoder switches between them when one hits its limit.' }),
                      button('Add API key', 'primary small', () => openSettings('keys'), 'plus'),
                  ),
              )
            : null,
        h(
            'div',
            { class: 'suggestions' },
            ...SUGGESTIONS.map((text) => {
                const suggestion = h('button', { class: 'suggestion', attrs: { type: 'button' } }, icon('spark'), h('span', { text }));
                suggestion.addEventListener('click', () => {
                    input.value = text;
                    autosize();
                    renderComposer();
                    input.focus();
                });
                return suggestion;
            }),
        ),
        settings && settings.usableKeys > 0
            ? h(
                  'div',
                  { class: 'welcome-status' },
                  h('span', { class: 'status-dot active' }),
                  `${settings.usableKeys} key${settings.usableKeys === 1 ? '' : 's'} ready · ${settings.model === 'auto' ? 'Auto routing' : modelName(settings.model)}`,
              )
            : null,
    );
}

function updateEmpty(): void {
    const empty = transcript.isEmpty;
    welcome.hidden = !empty;
    if (empty) {
        renderWelcome();
    }
}

function renderComposer(): void {
    const mode = MODES[settings?.mode ?? 'auto-edit'];
    modeButton.replaceChildren(icon(mode.icon), h('span', { text: mode.label }), icon('chevronDown', 'caret'));
    modeButton.title = `Permissions — ${mode.description}`;
    const model = settings?.model ?? 'auto';
    modelButton.replaceChildren(icon(model === 'auto' ? 'spark' : 'layers'), h('span', { text: model === 'auto' ? 'Auto' : modelName(model) }), icon('chevronDown', 'caret'));
    modelButton.title = model === 'auto' ? 'Smart routing: fast models for quick tasks, strong models for builds' : `Model: ${model}`;
    sendButton.replaceChildren(icon(running ? 'stop' : 'send'));
    sendButton.title = running ? 'Stop (Esc)' : 'Send (Enter)';
    sendButton.classList.toggle('stop', running);
    sendButton.disabled = !running && !input.value.trim();
    renderFoot();
}

function renderFoot(): void {
    const parts: Node[] = [];
    if (settings) {
        const count = settings.usableKeys;
        const keys = h('button', { class: 'foot-link', title: 'Manage API keys', attrs: { type: 'button' } }, h('span', { class: `status-dot ${count ? 'active' : 'invalid'}` }), `${count} key${count === 1 ? '' : 's'} active`);
        keys.addEventListener('click', () => openSettings('keys'));
        const today = settings.usage.today.inputTokens + settings.usage.today.outputTokens;
        const usageLink = h('button', { class: 'foot-link', title: 'Usage and quota', attrs: { type: 'button' } }, icon('gauge'), `${compactNumber(today)} tokens today`);
        usageLink.addEventListener('click', () => openSettings('usage'));
        parts.push(keys, usageLink);
    }
    if (usage.contextLimit > 0 && usage.contextTokens > 0) {
        const percent = Math.min(100, Math.round((usage.contextTokens / usage.contextLimit) * 100));
        parts.push(
            h('span', {
                class: `foot-ctx${percent >= 80 ? ' warn' : ''}`,
                text: `Context ${percent}%`,
                title: `This chat uses ${compactNumber(usage.contextTokens)} of ${compactNumber(usage.contextLimit)} context tokens. Older messages are summarized automatically when it fills up.`,
            }),
        );
    }
    foot.replaceChildren(...parts);
}

function renderBanner(): void {
    const warnings = settings?.warnings ?? [];
    banner.hidden = !warnings.length || (settings?.keys.length === 0 && transcript.isEmpty);
    fill(
        banner,
        icon('alert'),
        h('span', { class: 'banner-text', text: warnings[0] ?? '' }),
        warnings.length > 1 ? h('span', { class: 'banner-more', text: `+${warnings.length - 1} more` }) : null,
        icon('chevron'),
    );
    banner.title = warnings.join('\n');
}

let menuAnchor: HTMLElement | undefined;

function openMenu(anchor: HTMLElement, items: MenuItem[]): void {
    if (menuAnchor === anchor && !menu.hidden) {
        closeMenu();
        return;
    }
    menuAnchor = anchor;
    menu.replaceChildren(
        ...items.map((item) => {
            if (item.kind === 'header') {
                return h('div', { class: 'menu-header', text: item.label });
            }
            const row = h(
                'button',
                { class: `menu-item${item.selected ? ' selected' : ''}`, attrs: { type: 'button' } },
                item.icon ? icon(item.icon) : h('span', { class: 'icon' }),
                h('span', { class: 'menu-text' }, h('span', { class: 'menu-label', text: item.label }), item.description ? h('span', { class: 'menu-desc', text: item.description }) : null),
                item.selected ? icon('check', 'menu-check') : null,
            );
            row.addEventListener('click', () => {
                closeMenu();
                item.run();
            });
            return row;
        }),
    );
    menu.hidden = false;
}

function closeMenu(): void {
    menu.hidden = true;
    menuAnchor = undefined;
}

modeButton.addEventListener('click', () => {
    const current = settings?.mode ?? 'auto-edit';
    openMenu(
        modeButton,
        (Object.keys(MODES) as PermissionMode[]).map((mode) => ({
            kind: 'item',
            label: MODES[mode].label,
            description: MODES[mode].description,
            icon: MODES[mode].icon,
            selected: mode === current,
            run: () => {
                if (settings) {
                    settings.mode = mode;
                }
                renderComposer();
                send({ type: 'setMode', mode });
            },
        })),
    );
});

modelButton.addEventListener('click', () => {
    const current = settings?.model ?? 'auto';
    const setModel = (model: string) => {
        if (settings) {
            settings.model = model;
        }
        renderComposer();
        send({ type: 'setModel', model });
    };
    const items: MenuItem[] = [
        { kind: 'item', label: 'Auto', description: 'Fast models for quick tasks, strongest for builds', icon: 'spark', selected: current === 'auto', run: () => setModel('auto') },
    ];
    const withKeys = new Set((settings?.keys ?? []).filter((k) => k.enabled && k.status !== 'invalid').map((k) => k.provider));
    for (const provider of settings?.providers ?? []) {
        if (!withKeys.has(provider.id)) {
            continue;
        }
        items.push({ kind: 'header', label: provider.label });
        for (const model of provider.models) {
            const ref = `${provider.id}:${model}`;
            items.push({ kind: 'item', label: model, icon: 'layers', selected: current === ref, run: () => setModel(ref) });
        }
    }
    items.push({ kind: 'header', label: '' }, { kind: 'item', label: 'Keys and routing…', icon: 'gear', run: () => openSettings('model') });
    openMenu(modelButton, items);
});

document.addEventListener('click', (event) => {
    const target = event.target as Node;
    if (!menu.hidden && !menu.contains(target) && !menuAnchor?.contains(target)) {
        closeMenu();
    }
});

function autosize(): void {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
}

function submit(): void {
    if (running) {
        send({ type: 'stop' });
        return;
    }
    const text = input.value.trim();
    if (!text) {
        return;
    }
    lastPrompt = text;
    send({ type: 'send', text });
    input.value = '';
    autosize();
    renderComposer();
}

input.addEventListener('input', () => {
    autosize();
    sendButton.disabled = !running && !input.value.trim();
});

input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (!running) {
            submit();
        }
    } else if (event.key === 'Escape') {
        if (!menu.hidden) {
            closeMenu();
        } else if (running) {
            send({ type: 'stop' });
        }
    } else if (event.key === 'ArrowUp' && !input.value && lastPrompt) {
        event.preventDefault();
        input.value = lastPrompt;
        autosize();
        renderComposer();
    }
});

sendButton.addEventListener('click', submit);

let toastTimer = 0;
function showToast(message: string, level: 'info' | 'error'): void {
    toast.className = `toast ${level}`;
    toast.replaceChildren(icon(level === 'error' ? 'alert' : 'check'), h('span', { text: message }));
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
        toast.hidden = true;
    }, 4_500);
}
toast.addEventListener('click', () => {
    toast.hidden = true;
});

function applySettings(): void {
    if (!settings) {
        return;
    }
    settingsPanel.update(settings);
    renderComposer();
    renderBanner();
    updateEmpty();
}

window.addEventListener('fac:open-settings', (event) => openSettings((event as CustomEvent<SettingsSection>).detail));

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
    const message = event.data;
    switch (message.type) {
        case 'state':
            settings = message.settings;
            running = message.running;
            hasWorkspace = message.hasWorkspace;
            applySettings();
            break;
        case 'settings':
            settings = message.settings;
            applySettings();
            break;
        case 'usage':
            usage = { sessionTokens: message.sessionTokens, contextTokens: message.contextTokens, contextLimit: message.contextLimit };
            renderFoot();
            break;
        case 'reset':
            transcript.clear();
            running = false;
            renderComposer();
            renderBanner();
            break;
        case 'toast':
            showToast(message.message, message.level);
            break;
        case 'keyResult':
            settingsPanel.keyResult(message);
            break;
        case 'keyTest':
            settingsPanel.keyTest(message);
            break;
        case 'showSettings':
            openSettings(message.section);
            break;
        case 'focusInput':
            closeSettings();
            break;
        default:
            if (message.type === 'turnStart') {
                running = true;
                renderComposer();
            } else if (message.type === 'turnEnd') {
                running = false;
                renderComposer();
            }
            transcript.handle(message);
    }
});

renderComposer();
updateEmpty();
send({ type: 'ready' });
