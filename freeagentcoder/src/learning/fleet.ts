import { normalise } from '../fyx/learned';

/**
 * What this install shares to improve the agent for everyone, once the user
 * chose "OK, start using the agent": task outcomes, ratings, general lessons,
 * normalised error patterns, and Fyx chores with names removed. Never code,
 * file contents or prompts. Everything is cleaned here, on this machine, and
 * checked again by the site.
 *
 * Items wait in a small queue and are sent a few at a time; nothing is queued
 * at all while sharing is off.
 */

export interface Outcome {
    kind: string;
    tier: 'fast' | 'deep';
    provider: string;
    model: string;
    completed: boolean;
    corrected: boolean;
    steps: number;
    tokens: number;
    durationMs: number;
    paused: boolean;
    repeatedErrors: number;
    /** Changed files, passed a check or started a server. A task that only told the user what to do did not. */
    worked?: boolean;
}

export interface Rating {
    kind: string;
    provider: string;
    model: string;
    good: boolean;
    reasons: string[];
}

export interface Queue {
    outcomes: Outcome[];
    feedback: Rating[];
    lessons: { text: string; stack: string }[];
    errors: { signature: string; tool: string; stack: string; count: number; repeats: number }[];
    fyx: { pattern: string; command: string }[];
}

export { RATING_REASONS } from '../shared/protocol';

const CAPS: { [K in keyof Queue]: number } = { outcomes: 50, feedback: 50, lessons: 20, errors: 50, fyx: 20 };

export function emptyQueue(): Queue {
    return { outcomes: [], feedback: [], lessons: [], errors: [], fyx: [] };
}

export function queueSize(q: Queue): number {
    return q.outcomes.length + q.feedback.length + q.lessons.length + q.errors.length + q.fyx.length;
}

/** Adds items, keeping the newest when a list is full. */
export function enqueue<K extends keyof Queue>(q: Queue, key: K, items: Queue[K]): Queue {
    const list = [...(q[key] as unknown[]), ...(items as unknown[])].slice(-CAPS[key]);
    return { ...q, [key]: list };
}

/** A rule that could only be about this user's project is kept on this machine. */
export function isShareableRule(rule: string): boolean {
    if (rule.length < 12 || rule.length > 240) {
        return false;
    }
    return !(
        /[\w.-]+[\\/][\w.-]+[\\/]/.test(rule) ||
        /[a-z]:\\|~\//i.test(rule) ||
        /https?:\/\/|www\./i.test(rule) ||
        /[\w.+-]+@[\w-]+\.[\w.]+/.test(rule) ||
        /\b[A-Za-z0-9_-]{24,}\b/.test(rule) ||
        /\d{6,}/.test(rule) ||
        /\b(password|secret|token|api[_ -]?key)\s*[:=]/i.test(rule)
    );
}

const COMMAND_WORDS = new Set(['git', 'npm', 'npx', 'pnpm', 'yarn', 'pip', 'python', 'node', 'tar', 'zip', 'unzip', 'run', 'install', 'push', 'pull', 'commit', 'checkout', 'branch', 'origin']);

/**
 * A learned chore as a pattern: every word of the request that also appears
 * in the command (a folder, a branch, a package) becomes a placeholder, so
 * "zip the homes folder" → `tar … homes.zip homes` is shared as
 * "zip the {name} folder" → `tar … {name}.zip {name}`. Undefined when names
 * would still be left in it.
 */
export function chorePattern(prompt: string, command: string): { pattern: string; command: string } | undefined {
    const request = normalise(prompt);
    let pattern = request;
    let template = command.trim();
    const names = [...new Set(request.split(' '))].filter((w) => w.length >= 2 && !COMMAND_WORDS.has(w) && new RegExp(`(^|[^\\w-])${escape(w)}([^\\w-]|$)`, 'i').test(template));
    names.forEach((name, i) => {
        const slot = `{name${i ? i + 1 : ''}}`;
        pattern = pattern.replace(new RegExp(`\\b${escape(name)}\\b`, 'g'), slot);
        template = template.replace(new RegExp(`(^|[^\\w-])${escape(name)}(?=[^\\w-]|$)`, 'gi'), `$1${slot}`);
    });
    const shareable =
        /^[a-z0-9 {}'"._-]{3,80}$/i.test(pattern) &&
        template.length <= 160 &&
        !/[\\/]{2}|https?:|@|\b[A-Za-z0-9_-]{24,}\b/.test(template) &&
        template.split(/\s+/).every((w) => /^(?:\{\w+\}|[-\w.=:,])+$/.test(w));
    return shareable ? { pattern, command: template } : undefined;
}

function escape(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
