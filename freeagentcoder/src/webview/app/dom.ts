import type { FromWebview } from '../../shared/protocol';
import { icon, type IconName } from './icons';

interface VsCodeApi {
    postMessage(message: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const api = acquireVsCodeApi();

export function send(message: FromWebview): void {
    api.postMessage(message);
}

type Child = Node | string | null | undefined | false;

export interface Props {
    class?: string;
    text?: string;
    title?: string;
    hidden?: boolean;
    attrs?: Record<string, string>;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    if (props.class) {
        el.className = props.class;
    }
    if (props.text !== undefined) {
        el.textContent = props.text;
    }
    if (props.title) {
        el.title = props.title;
    }
    if (props.hidden) {
        el.hidden = true;
    }
    for (const [name, value] of Object.entries(props.attrs ?? {})) {
        el.setAttribute(name, value);
    }
    for (const child of children) {
        if (child !== null && child !== undefined && child !== false) {
            el.append(child);
        }
    }
    return el;
}

/** replaceChildren that skips conditional (null/false) children. */
export function fill(parent: Element, ...children: Child[]): void {
    parent.replaceChildren(...children.filter((child): child is Node | string => child !== null && child !== undefined && child !== false));
}

export function button(label: string, variant: string, onClick: () => void, iconName?: IconName, title?: string): HTMLButtonElement {
    const el = h('button', { class: `btn ${variant}`, attrs: { type: 'button' }, title }, iconName ? icon(iconName) : null, label ? h('span', { text: label }) : null);
    el.addEventListener('click', onClick);
    return el;
}

export function iconButton(name: IconName, title: string, onClick: () => void): HTMLButtonElement {
    const el = h('button', { class: 'icon-btn', title, attrs: { type: 'button', 'aria-label': title } }, icon(name));
    el.addEventListener('click', onClick);
    return el;
}

export function fileLink(path: string, line?: number): HTMLAnchorElement {
    const attrs: Record<string, string> = { href: '#', 'data-path': path };
    if (line) {
        attrs['data-line'] = String(line);
    }
    return h('a', { class: 'file-ref', text: path, title: `Open ${path}`, attrs });
}

/** Delegated handler for copy buttons, file references and external links inside rendered content. */
export function handleContentClick(event: Event): void {
    const target = event.target as HTMLElement | null;
    const copy = target?.closest<HTMLButtonElement>('.code-copy');
    if (copy) {
        const code = copy.closest('.code-block')?.querySelector('code')?.textContent ?? '';
        send({ type: 'copy', text: code });
        copy.textContent = 'Copied';
        setTimeout(() => {
            copy.textContent = 'Copy';
        }, 1200);
        return;
    }
    const fileRef = target?.closest<HTMLAnchorElement>('a.file-ref');
    if (fileRef) {
        event.preventDefault();
        const line = Number(fileRef.dataset.line);
        send({ type: 'openFile', path: fileRef.dataset.path ?? '', line: line > 0 ? line : undefined });
        return;
    }
    const external = target?.closest<HTMLAnchorElement>('a[data-external]');
    if (external) {
        event.preventDefault();
        send({ type: 'openExternal', url: external.getAttribute('href') ?? '' });
    }
}

export function openSettingsEvent(section: string): void {
    window.dispatchEvent(new CustomEvent('fac:open-settings', { detail: section }));
}
