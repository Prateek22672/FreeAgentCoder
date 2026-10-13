import type { LearningView } from '../../shared/protocol';
import { button, h, handleContentClick, openSettingsEvent, send } from './dom';
import { icon, type IconName } from './icons';

/**
 * CROCS Security by FreeAgentCoder: the "Learn more" popup that explains, in
 * plain words, what stays on this computer, what goes to the AI provider the
 * user chose, and how the optional sharing works. Every line here describes
 * what the code does; keep it that way when either changes.
 */

const PROTECTIONS: { icon: IconName; title: string; text: string }[] = [
    { icon: 'history', title: 'Local-first', text: 'Your chats, settings and error log are stored by VS Code on this computer. We have no copy and no server that keeps them.' },
    { icon: 'key', title: 'Keys in your keychain', text: 'API keys are kept in VS Code Secret Storage, which uses your operating system’s keychain. They are never written to files or logs.' },
    { icon: 'eye', title: 'Only what the task needs', text: 'The model sees your request and the files the agent opens for it, never your whole workspace by default.' },
    { icon: 'shield', title: 'Secrets hidden from the model', text: 'Keys, tokens, passwords and private keys found in files and command output are masked before anything is sent. The real values stay in your files, and edits that would overwrite them are refused.' },
    { icon: 'lock', title: 'Encrypted connections', text: 'Every request goes over HTTPS, straight from your computer to the provider you chose.' },
    { icon: 'trash', title: 'You can delete it', text: 'Delete saved chats or turn history off in Settings → History, and forget anything learned in Settings → Learning.' },
];

let open: HTMLElement | undefined;

export function crocsLink(label = 'Learn more'): HTMLButtonElement {
    const link = h('button', { class: 'link-button crocs-link', attrs: { type: 'button' }, text: label });
    link.addEventListener('click', () => openCrocs());
    return link;
}

/** A small trust line: a shield, a short promise, and Learn more. */
export function crocsLine(text = 'Protected by CROCS Security: your chats stay on this computer.', align: 'center' | 'left' = 'center'): HTMLElement {
    return h('p', { class: `crocs-line${align === 'left' ? ' left' : ''}` }, icon('shield'), h('span', { text: `${text} ` }), crocsLink());
}

let sharing: LearningView['sharing'] = 'unasked';
export function setCrocsSharing(value: LearningView['sharing']): void {
    sharing = value;
}

export function openCrocs(): void {
    if (open) {
        return;
    }
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const close = () => {
        overlay.remove();
        open = undefined;
        document.removeEventListener('keydown', onKey, true);
        returnFocus?.focus();
    };
    const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
        } else if (event.key === 'Tab') {
            // Keep focus inside the dialog.
            const focusable = [...dialog.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.hasAttribute('disabled'));
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        }
    };

    const closeButton = h('button', { class: 'icon-btn crocs-close', attrs: { type: 'button', 'aria-label': 'Close' } }, icon('close'));
    closeButton.addEventListener('click', close);

    const share = h('input', { attrs: { type: 'checkbox', id: 'crocs-share', role: 'switch' } });
    share.checked = sharing === 'on';
    share.disabled = sharing === 'blocked';
    share.addEventListener('change', () => {
        sharing = share.checked ? 'on' : 'off';
        send({ type: 'setSharing', on: share.checked });
    });
    const seeShared = h('button', { class: 'link-button', attrs: { type: 'button' }, text: 'See exactly what is sent' });
    seeShared.addEventListener('click', () => send({ type: 'showShared' }));
    const history = h('button', { class: 'link-button', attrs: { type: 'button' }, text: 'Saved chats' });
    history.addEventListener('click', () => {
        close();
        openSettingsEvent('history');
    });
    const learning = h('button', { class: 'link-button', attrs: { type: 'button' }, text: 'What it has learned' });
    learning.addEventListener('click', () => {
        close();
        openSettingsEvent('learning');
    });

    const dialog = h(
        'div',
        { class: 'crocs-dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'crocs-title' } },
        h(
            'div',
            { class: 'crocs-head' },
            h('span', { class: 'crocs-badge' }, icon('shield')),
            h('div', {}, h('h2', { attrs: { id: 'crocs-title' }, text: 'CROCS Security' }), h('div', { class: 'crocs-sub', text: 'by FreeAgentCoder' })),
            closeButton,
        ),
        h(
            'p',
            { class: 'crocs-intro' },
            'Our privacy-first way of working: your chats stay on your computer, the model gets only what a task needs, secrets are hidden from it, and anything shared is your choice.',
        ),
        h(
            'section',
            {},
            h('h3', { text: 'Your data stays under your control' }),
            h(
                'ul',
                { class: 'crocs-grid' },
                ...PROTECTIONS.map((p) => h('li', {}, icon(p.icon), h('div', {}, h('strong', { text: p.title }), h('span', { text: p.text })))),
            ),
        ),
        h(
            'section',
            {},
            h('h3', { text: 'What reaches an AI provider' }),
            h(
                'p',
                { class: 'muted' },
                'To answer, your request and the files the agent reads go to the provider of the key in use (Google Gemini, Groq, NVIDIA, Mistral, Cohere, OpenRouter, or your own OpenAI or Anthropic key). That provider processes them under its own terms, and some free tiers may use requests to improve their models, so check its data policy before working on sensitive code. The free trial passes requests through our server to those providers; it counts them and does not store what they say. Looking up library docs sends only the library name and topic, and finding a photo for a document sends only the search words (to Wikimedia Commons or Openverse).',
            ),
        ),
        h(
            'section',
            { class: 'crocs-choice' },
            h('h3', { text: 'Your choice: help make it smarter' }),
            h(
                'p',
                { class: 'muted' },
                'If you like, FreeAgentCoder shares what it learns: general lessons from your corrections, errors that keep coming back, how tasks ended, and your 👍 / 👎. Never your code, files, prompts or keys. Names, paths and secrets are removed on your computer first. It is completely optional and everything works the same without it.',
            ),
            h(
                'label',
                { class: 'crocs-switch', attrs: { for: 'crocs-share' } },
                share,
                h('span', { text: sharing === 'blocked' ? 'Sharing is turned off by your VS Code telemetry setting' : 'Share what it learns with every user' }),
            ),
            h('p', { class: 'crocs-links' }, seeShared, ' · ', history, ' · ', learning),
        ),
        h(
            'p',
            { class: 'crocs-foot' },
            'CROCS Security is how we build FreeAgentCoder, not an external certification. Secret masking catches common formats and may miss unusual ones. ',
            h('a', { attrs: { href: 'https://github.com/Prateek22672/FreeAgentCoder-Codeloft#privacy', 'data-external': '' }, text: 'Privacy details' }),
        ),
        h('div', { class: 'crocs-actions' }, button('Got it', 'primary', close, 'check')),
    );

    dialog.addEventListener('click', handleContentClick);
    const overlay = h('div', { class: 'crocs-overlay' }, dialog);
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            close();
        }
    });
    document.body.append(overlay);
    open = overlay;
    document.addEventListener('keydown', onKey, true);
    closeButton.focus();
}
