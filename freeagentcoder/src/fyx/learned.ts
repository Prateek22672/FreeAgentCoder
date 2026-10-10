import type { FyxPlan } from './plan';

/**
 * How Fyx gets better with use, on this computer only. When the AI agent
 * finishes a short request by running exactly one command, and nothing else,
 * the request and that command are remembered. The next time the same request
 * is typed, Fyx runs the command itself: no model, no tokens. It still asks the
 * same permission before running anything.
 *
 * Only exact requests (after dropping filler such as "please")
 * are replayed, so "push to main" never runs what "push to dev" learned.
 */

export interface Learned {
    command: string;
    uses: number;
    learnedAt: number;
    lastUsed: number;
}

export interface MementoLike {
    get<T>(key: string, fallback: T): T;
    update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

const KEY = 'freeagentcoder.fyx.learned';
const MAX = 200;
const FILLER = /\b(please|pls|hey|hi|can you|could you|would you|kindly|for me|now|just|quickly|real quick)\b/g;

export function normalise(prompt: string): string {
    return prompt
        .toLowerCase()
        .replace(/[^\w\s./@:+\-"']/g, ' ')
        .replace(FILLER, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Commands never learned: anything that deletes, rewrites history, publishes, or runs code from the internet. */
const RISKY = /\b(rm|del|rmdir|erase|remove-item|format|mkfs|dd|sudo|shutdown|reboot|kill|taskkill|chmod|chown|deploy|publish|release)\b|--force\b|(?<!\btar\b[^|;&\n]*)\s-f\b|reset\s+--hard|clean\s+-[a-z]*f|push\s+.*--delete|\|\s*(sh|bash|iex|invoke-expression)\b|curl|wget|invoke-webrequest|iwr\b|>\s*\/dev\//i;

export function worthLearning(prompt: string, command: string): boolean {
    const words = prompt.trim().split(/\s+/).length;
    return words >= 2 && words <= 20 && command.length <= 300 && !command.includes('\n') && !RISKY.test(command);
}

export class LearnedCommands {
    constructor(private readonly memento: MementoLike) {}

    private all(): Record<string, Learned> {
        return this.memento.get<Record<string, Learned>>(KEY, {});
    }

    plan(prompt: string): FyxPlan | undefined {
        const found = this.all()[normalise(prompt)];
        if (!found) {return undefined;}
        return {
            kind: 'learned',
            intro: 'Running the command that did this last time.',
            steps: [{ command: found.command, timeout: 600 }],
            done: 'Done, the same way as last time.',
        };
    }

    async used(prompt: string): Promise<void> {
        const all = this.all();
        const key = normalise(prompt);
        const entry = all[key];
        if (!entry) {return;}
        all[key] = { ...entry, uses: entry.uses + 1, lastUsed: Date.now() };
        await this.memento.update(KEY, all);
    }

    async learn(prompt: string, command: string): Promise<boolean> {
        if (!worthLearning(prompt, command)) {return false;}
        const all = this.all();
        const key = normalise(prompt);
        if (!key) {return false;}
        all[key] = { command, uses: all[key]?.uses ?? 0, learnedAt: Date.now(), lastUsed: Date.now() };
        // Keep the most recently used ones.
        const entries = Object.entries(all).sort((a, b) => b[1].lastUsed - a[1].lastUsed).slice(0, MAX);
        await this.memento.update(KEY, Object.fromEntries(entries));
        return true;
    }

    /** Forgets one request, when the user says it was wrong. */
    async forget(prompt: string): Promise<void> {
        const all = this.all();
        delete all[normalise(prompt)];
        await this.memento.update(KEY, all);
    }

    /** Everything learned, newest first. */
    list(): ({ prompt: string } & Learned)[] {
        return Object.entries(this.all())
            .map(([prompt, entry]) => ({ prompt, ...entry }))
            .sort((a, b) => b.learnedAt - a.learnedAt);
    }

    /** Forgets by the stored request, as list() shows it. */
    async forgetKey(prompt: string): Promise<boolean> {
        const all = this.all();
        if (!(prompt in all)) {return false;}
        delete all[prompt];
        await this.memento.update(KEY, all);
        return true;
    }

    count(): number {
        return Object.keys(this.all()).length;
    }
}
