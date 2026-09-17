import './styles.css';
import { compactNumber } from '../../shared/format';
import type { AttachmentInput, PermissionMode, SettingsSection, SettingsView, ToWebview } from '../../shared/protocol';
import { button, fill, h, iconButton, send } from './dom';
import { icon, type IconName } from './icons';
import { SettingsPanel, setupGuide } from './settings';
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
let attachments: AttachmentInput[] = [];
let correctionMode = false;

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,.pdf,.docx,.pptx,.xlsx,.txt,.md,.markdown,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm,.rtf,.log';
const MAX_ATTACHMENTS = 10;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const LONG_PASTE_CHARS = 4_000;
const LONG_PASTE_LINES = 80;
const PLACEHOLDER = 'Ask FreeAgentCoder to build, fix or explain…';

const app = document.getElementById('app') as HTMLElement;

const header = h(
    'header',
    { class: 'app-header' },
    h('div', { class: 'brand' }, icon('mark', 'brand-mark'), h('span', { text: 'FreeAgentCoder' })),
    h(
        'div',
        { class: 'header-actions' },
        iconButton('plus', 'New chat', () => send({ type: 'newChat' })),
        iconButton('history', 'Chat history', () => openSettings('history')),
        iconButton('gear', 'Settings', () => openSettings()),
    ),
);
const banner = h('button', { class: 'banner', hidden: true, attrs: { type: 'button' } });
banner.addEventListener('click', () => openSettings(settings?.usableKeys ? 'usage' : 'keys'));

const welcome = h('div', { class: 'welcome' });
const list = h('div', { class: 'transcript' });
const scroller = h('main', { class: 'scroller' }, welcome, list);
const transcript = new Transcript(scroller, list, () => updateEmpty());

const input = h('textarea', { class: 'composer-input', attrs: { rows: '1', placeholder: PLACEHOLDER } });
const modeButton = h('button', { class: 'pill', attrs: { type: 'button' } });
const modelButton = h('button', { class: 'pill', attrs: { type: 'button' } });
const sendButton = h('button', { class: 'send-btn', attrs: { type: 'button' } });
const menu = h('div', { class: 'menu', hidden: true });
const fileInput = h('input', { hidden: true, attrs: { type: 'file', multiple: '', accept: ACCEPT } });
const attachButton = iconButton('paperclip', 'Attach screenshots, PDFs, Word, PowerPoint, Excel or text files. You can also paste or drop them.', () => fileInput.click());
const attachRow = h('div', { class: 'attach-row', hidden: true });
const composer = h(
    'div',
    { class: 'composer' },
    menu,
    attachRow,
    input,
    h('div', { class: 'composer-bar' }, attachButton, modeButton, modelButton, h('span', { class: 'spacer' }), sendButton),
    fileInput,
);
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
        needsKey && settings
            ? setupGuide(settings, (provider) => {
                  openSettings('keys');
                  settingsPanel.addKey(provider);
              })
            : null,
        needsKey ? h('p', { class: 'welcome-note' }, icon('lock'), 'Keys stay on this device, encrypted in VS Code Secret Storage.') : null,
        h(
            'div',
            { class: 'suggestions' },
            hasWorkspace && !needsKey ? testSuggestion() : null,
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

/** Runs the project's own checks and explains any failure, without the user having to know the commands. */
function testSuggestion(): HTMLElement {
    const el = h(
        'button',
        { class: 'suggestion test', attrs: { type: 'button' }, title: 'Detects your build, type check, lint and tests, runs them, and explains every failure with a fix' },
        icon('shield'),
        h('span', { text: 'Test my project and explain any failures' }),
    );
    el.addEventListener('click', () => send({ type: 'testProject' }));
    return el;
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
    sendButton.disabled = !running && !input.value.trim() && !attachments.length;
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
        const left = settings.overview.promptsLeft;
        if (left.value !== undefined && settings.usableKeys > 0) {
            const low = !left.atLeast && left.value < 15;
            const leftLink = h(
                'button',
                { class: `foot-link${low ? ' warn' : ''}`, title: `${left.basis} Click for details.`, attrs: { type: 'button' } },
                icon('spark'),
                `${left.atLeast ? `${left.value}+` : `≈${left.value}`} prompts left`,
            );
            leftLink.addEventListener('click', () => openSettings('overview'));
            parts.push(leftLink);
        }
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

function formatSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderAttachments(): void {
    const chips: HTMLElement[] = [];
    if (correctionMode) {
        chips.push(
            h(
                'span',
                { class: 'attach-chip correction', title: 'Each point you describe is fixed precisely and verified separately' },
                icon('target'),
                h('span', { class: 'attach-name', text: 'Correction mode' }),
                iconButton('close', 'Turn off correction mode', () => {
                    correctionMode = false;
                    renderAttachments();
                }),
            ),
        );
    }
    attachments.forEach((item, index) => {
        chips.push(
            h(
                'span',
                { class: 'attach-chip', title: item.name },
                item.thumb ? h('img', { attrs: { src: item.thumb, alt: '' } }) : icon(item.kind === 'text' ? 'list' : 'file'),
                h('span', { class: 'attach-name', text: item.name }),
                h('span', { class: 'attach-size', text: formatSize(item.size) }),
                iconButton('close', `Remove ${item.name}`, () => {
                    attachments.splice(index, 1);
                    renderAttachments();
                    renderComposer();
                }),
            ),
        );
    });
    fill(attachRow, ...chips);
    attachRow.hidden = !chips.length;
    input.placeholder = correctionMode ? "Describe what's wrong and what it should be. Paste a screenshot if it helps…" : PLACEHOLDER;
}

function readAsDataUrl(file: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
        reader.readAsDataURL(file);
    });
}

function base64Of(dataUrl: string): string {
    return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

/** Screenshots are scaled to at most 2000px (plenty for reading text) and get a small preview for the chat. */
async function imageAttachment(file: File, name: string): Promise<AttachmentInput> {
    const dataUrl = await readAsDataUrl(file);
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const draw = (max: number, type: string, quality: number) => {
        const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight, 1));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL(type, quality);
    };
    const thumb = draw(160, 'image/jpeg', 0.7);
    const supported = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type);
    const oversized = Math.max(image.naturalWidth, image.naturalHeight) > 2000 || file.size > 4 * 1024 * 1024;
    if (supported && (!oversized || file.type === 'image/gif')) {
        return { name, kind: 'image', mimeType: file.type, size: file.size, data: base64Of(dataUrl), thumb };
    }
    const type = file.type === 'image/png' || file.type === 'image/svg+xml' ? 'image/png' : 'image/jpeg';
    const data = base64Of(draw(2000, type, 0.9));
    return { name, kind: 'image', mimeType: type, size: Math.round(data.length * 0.75), data, thumb };
}

async function addFiles(files: File[]): Promise<void> {
    for (const file of files) {
        if (attachments.length >= MAX_ATTACHMENTS) {
            showToast(`You can attach up to ${MAX_ATTACHMENTS} files to a message.`, 'error');
            break;
        }
        if (file.size > MAX_FILE_BYTES) {
            showToast(`${file.name || 'That file'} is larger than 25 MB.`, 'error');
            continue;
        }
        const name = file.name || `pasted-image-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}.png`;
        try {
            if (file.type.startsWith('image/')) {
                attachments.push(await imageAttachment(file, name));
            } else {
                attachments.push({ name, kind: 'document', mimeType: file.type || 'application/octet-stream', size: file.size, data: base64Of(await readAsDataUrl(file)) });
            }
        } catch (error) {
            showToast(`Couldn't attach ${name}: ${error instanceof Error ? error.message : String(error)}`, 'error');
        }
    }
    renderAttachments();
    renderComposer();
}

fileInput.addEventListener('change', () => {
    void addFiles(Array.from(fileInput.files ?? []));
    fileInput.value = '';
});

input.addEventListener('paste', (event) => {
    const data = event.clipboardData;
    if (!data) {
        return;
    }
    const files = Array.from(data.files);
    if (files.length) {
        event.preventDefault();
        void addFiles(files);
        return;
    }
    const text = data.getData('text/plain');
    const lines = text.split('\n').length;
    if ((text.length > LONG_PASTE_CHARS || lines > LONG_PASTE_LINES) && attachments.length < MAX_ATTACHMENTS) {
        event.preventDefault();
        attachments.push({ name: `Pasted text (${lines} lines)`, kind: 'text', mimeType: 'text/plain', size: text.length, data: text });
        renderAttachments();
        renderComposer();
    }
});

composer.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault();
        composer.classList.add('dragging');
    }
});
composer.addEventListener('dragleave', () => composer.classList.remove('dragging'));
composer.addEventListener('drop', (event) => {
    composer.classList.remove('dragging');
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) {
        event.preventDefault();
        void addFiles(files);
    }
});

window.addEventListener('fac:correct', () => {
    correctionMode = true;
    renderAttachments();
    closeSettings();
});

function submit(): void {
    if (running) {
        send({ type: 'stop' });
        return;
    }
    const text = input.value.trim();
    if (!text && !attachments.length) {
        return;
    }
    lastPrompt = text;
    send({ type: 'send', text, attachments: attachments.length ? attachments : undefined, correction: correctionMode || undefined });
    input.value = '';
    attachments = [];
    correctionMode = false;
    renderAttachments();
    autosize();
    renderComposer();
}

input.addEventListener('input', () => {
    autosize();
    sendButton.disabled = !running && !input.value.trim() && !attachments.length;
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

let consentCard: HTMLElement | undefined;
function showHistoryConsent(): void {
    consentCard?.remove();
    const choose = (mode: 'on' | 'off') => {
        consentCard?.remove();
        consentCard = undefined;
        send({ type: 'setHistoryMode', mode });
    };
    consentCard = h(
        'div',
        { class: 'card consent' },
        h('div', { class: 'card-head' }, icon('history'), h('span', { class: 'card-title', text: 'Save your chats?' })),
        h(
            'div',
            { class: 'card-body' },
            h('p', { class: 'muted', text: 'FreeAgentCoder can keep your chats on this computer so you can reopen them later. Nothing is uploaded. You can change this or delete saved chats in Settings → History.' }),
            h('div', { class: 'consent-actions' }, button('Save chats', 'primary small', () => choose('on'), 'check'), button("Don't save", 'small', () => choose('off'))),
        ),
    );
    list.append(consentCard);
    scroller.scrollTop = scroller.scrollHeight;
}

let reportedErrors = 0;
function reportError(message: string): void {
    if (reportedErrors >= 20 || !message) {
        return;
    }
    reportedErrors++;
    send({ type: 'logError', message: message.slice(0, 2_000) });
}
window.addEventListener('error', (event) => reportError(event.error instanceof Error ? (event.error.stack ?? event.error.message) : event.message));
window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason;
    reportError(reason instanceof Error ? (reason.stack ?? reason.message) : String(reason));
});

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
        case 'clipboard':
            settingsPanel.clipboard(message);
            break;
        case 'history':
            settingsPanel.history(message);
            break;
        case 'logs':
            settingsPanel.logs(message);
            break;
        case 'historyConsent':
            showHistoryConsent();
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
