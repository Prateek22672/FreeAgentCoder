/**
 * @-mentions in the chat: `@src/app.ts` names a file. The webview suggests
 * files as you type; when the message is sent, mentioned files that exist go
 * along with it, so the agent starts with them instead of spending a step (and
 * a resend of the whole conversation) reading them.
 */

/** Per file and in all: a mention brings the file, not a whole codebase. */
const FILE_CHARS = 12_000;
const TOTAL_CHARS = 30_000;
export const MAX_MENTIONS = 6;

/** `@path` at the start or after a space; a trailing full stop or comma is not part of it. */
const MENTION = /(?:^|\s)@((?:[\w.\-]+\/)*[\w.\-]+)/g;

export function mentionedPaths(text: string): string[] {
    const found = new Set<string>();
    for (const match of text.matchAll(MENTION)) {
        const raw = match[1]!.replace(/[.,;:!?)]+$/, '');
        // An address (name@example.com) has no space before the @, so it never matches; neither does a bare @word without a dot or slash.
        if (raw && /[./]/.test(raw)) {
            found.add(raw);
        }
    }
    return [...found].slice(0, MAX_MENTIONS);
}

/** The token being typed at the caret, when it is a mention: what to look up. */
export function mentionAtCaret(text: string, caret: number): { start: number; query: string } | undefined {
    const match = /(?:^|\s)@([\w.\-/]*)$/.exec(text.slice(0, caret));
    return match ? { start: caret - match[1]!.length - 1, query: match[1]! } : undefined;
}

/** Best matches first: name starts with the query, then name contains it, then the path does; shorter paths win ties. */
export function rankFiles(files: string[], query: string, max = 8): string[] {
    const q = query.toLowerCase();
    const scored: { file: string; score: number }[] = [];
    for (const file of files) {
        const lower = file.toLowerCase();
        const name = lower.slice(lower.lastIndexOf('/') + 1);
        const score = !q ? 3 : name.startsWith(q) ? 0 : name.includes(q) ? 1 : lower.includes(q) ? 2 : subsequence(lower, q) ? 3 : -1;
        if (score >= 0) {
            scored.push({ file, score });
        }
    }
    return scored
        .sort((a, b) => a.score - b.score || a.file.length - b.file.length || a.file.localeCompare(b.file))
        .slice(0, max)
        .map((s) => s.file);
}

function subsequence(text: string, query: string): boolean {
    let i = 0;
    for (const char of text) {
        if (char === query[i]) {
            i++;
            if (i === query.length) {
                return true;
            }
        }
    }
    return false;
}

/** The block added to the message: each file numbered like read_file output, so edits can follow straight away. */
export function mentionBlock(files: { path: string; content: string }[]): { text: string; included: string[] } {
    let budget = TOTAL_CHARS;
    const parts: string[] = [];
    const included: string[] = [];
    for (const file of files) {
        if (budget <= 0) {
            parts.push(`### ${file.path}\n(not included, the mentioned files are long: read it with read_file)`);
            continue;
        }
        const lines = file.content.split(/\r?\n/);
        if (lines.length > 1 && lines[lines.length - 1] === '') {
            lines.pop();
        }
        const width = String(lines.length).length;
        let body = '';
        let shown = 0;
        const cap = Math.min(FILE_CHARS, budget);
        for (const line of lines) {
            const next = `${String(shown + 1).padStart(width)}\t${line}\n`;
            if (body.length + next.length > cap) {
                break;
            }
            body += next;
            shown++;
        }
        budget -= body.length;
        const whole = shown === lines.length;
        // Only a whole file counts as read; for part of one, the agent reads the rest first.
        if (whole) {
            included.push(file.path);
        }
        parts.push(`### ${file.path}${whole ? '' : ` (lines 1-${shown} of ${lines.length}; read the rest with read_file)`}\n${body.trimEnd()}`);
    }
    return {
        text: parts.length ? `\n\n## Files the user mentioned\nTheir current contents, with line numbers (not part of the file). No need to read them again.\n\n${parts.join('\n\n')}` : '',
        included,
    };
}
