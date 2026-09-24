/**
 * Reading a task out of a vscode:// link.
 *
 * The payload is untrusted when it arrives — anyone can craft such a link — so
 * every field is validated here, and the extension only ever places the brief
 * in the chat input for the user to read and send. Nothing runs by itself.
 *
 * The matching writer lives with the website. This file is deliberately
 * standalone so the extension depends on nothing outside itself: the format is
 * versioned, and a payload from a newer writer is refused with a message
 * asking the user to update, rather than half-understood.
 */

export const TASK_VERSION = 1;

/** Caps keep the link within what browsers and the OS pass to VS Code. */
export const TASK_LIMITS = { title: 200, brief: 9_000, files: 40, path: 300, repo: 140 };

export interface ProjectTask {
    v: 1;
    kind: 'project-task';
    /** owner/repo */
    repo: string;
    ref?: string;
    title: string;
    /** The Markdown the agent receives, exactly as the user will see it. */
    brief: string;
    files: string[];
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function fromBase64Url(text: string): Uint8Array | undefined {
    if (!/^[A-Za-z0-9_-]*$/.test(text)) {
        return undefined;
    }
    const bytes: number[] = [];
    for (let i = 0; i < text.length; i += 4) {
        const chunk = text.slice(i, i + 4);
        const values = [...chunk].map((c) => ALPHABET.indexOf(c));
        const n = ((values[0] ?? 0) << 18) | ((values[1] ?? 0) << 12) | ((values[2] ?? 0) << 6) | (values[3] ?? 0);
        bytes.push((n >> 16) & 255);
        if (chunk.length > 2) {
            bytes.push((n >> 8) & 255);
        }
        if (chunk.length > 3) {
            bytes.push(n & 255);
        }
    }
    return new Uint8Array(bytes);
}

/** Control characters other than tab and newline have no place in a brief. */
const clean = (text: string): string => text.replace(/[\u0000-\u0008\u000B-\u001F\u007F‪-‮⁦-⁩]/g, '');

/** A repository-relative path: no leading slash, no "..", no drive letters or URLs. */
const SAFE_PATH = /^(?![/\\])(?!.*(?:^|\/)\.\.(?:\/|$))(?![A-Za-z]:)(?!.*:\/\/)[^\u0000-\u001F]{1,300}$/;

/** Validate a payload from a link. Returns the task, or why it was refused. */
export function decodeTask(encoded: string): ProjectTask | { error: string } {
    if (encoded.length > 40_000) {
        return { error: 'The task link is too long.' };
    }
    const bytes = fromBase64Url(encoded);
    if (!bytes) {
        return { error: 'The task link is malformed.' };
    }
    let data: unknown;
    try {
        data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
        return { error: 'The task link is malformed.' };
    }
    const t = data as Partial<ProjectTask>;
    if (!t || typeof t !== 'object') {
        return { error: 'The task link is malformed.' };
    }
    if (t.v !== TASK_VERSION) {
        return { error: `This task was made by a newer version of the planner (version ${String(t.v)}). Update the extension.` };
    }
    if (t.kind !== 'project-task') {
        return { error: 'Not a task link.' };
    }
    if (typeof t.repo !== 'string' || !/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(t.repo)) {
        return { error: 'The task names an invalid repository.' };
    }
    if (t.ref !== undefined && (typeof t.ref !== 'string' || !/^[\w./-]{1,200}$/.test(t.ref))) {
        return { error: 'The task names an invalid branch.' };
    }
    if (typeof t.title !== 'string' || !t.title.trim() || t.title.length > TASK_LIMITS.title) {
        return { error: 'The task has no valid title.' };
    }
    if (typeof t.brief !== 'string' || !t.brief.trim() || t.brief.length > TASK_LIMITS.brief) {
        return { error: 'The task has no valid brief.' };
    }
    if (!Array.isArray(t.files) || t.files.length > TASK_LIMITS.files || !t.files.every((f) => typeof f === 'string' && SAFE_PATH.test(f))) {
        return { error: 'The task lists invalid file paths.' };
    }
    return {
        v: TASK_VERSION,
        kind: 'project-task',
        repo: t.repo,
        ...(t.ref ? { ref: t.ref } : {}),
        title: clean(t.title).trim(),
        brief: clean(t.brief).trim(),
        files: t.files,
    };
}
