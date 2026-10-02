/**
 * The editor's own problems (type errors, lint errors, syntax errors), in a
 * shape the agent can read. Kept free of the vscode module so it can be tested.
 */

export interface Problem {
    /** Path relative to the project root. */
    file: string;
    line: number;
    column: number;
    severity: 'error' | 'warning';
    message: string;
    source?: string;
    code?: string;
}

/** Files a language server is likely to check; edits to anything else are not waited on. */
export const CHECKED_FILES =
    /\.(?:[cm]?[jt]sx?|vue|svelte|astro|py|pyi|go|rs|java|kt|cs|php|rb|swift|dart|c|cc|cpp|h|hpp|css|scss|less|json|jsonc|html?)$/i;

const key = (p: Problem) => `${p.file}\u0000${p.severity}\u0000${p.source ?? ''}\u0000${p.code ?? ''}\u0000${p.message}`;

/**
 * Problems in `after` that were not in `before`. Matched by file, kind and
 * message rather than line, since an edit moves the lines below it; a message
 * that now appears more often counts its extra copies as new.
 */
export function introduced(before: Problem[], after: Problem[]): Problem[] {
    const seen = new Map<string, number>();
    for (const p of before) {
        seen.set(key(p), (seen.get(key(p)) ?? 0) + 1);
    }
    return after.filter((p) => {
        const left = seen.get(key(p)) ?? 0;
        if (left > 0) {
            seen.set(key(p), left - 1);
            return false;
        }
        return true;
    });
}

export function problemLine(p: Problem): string {
    const tag = [p.source, p.code].filter(Boolean).join(' ');
    return `${p.file}:${p.line}:${p.column} ${p.severity}${tag ? ` (${tag})` : ''}: ${p.message.split('\n')[0]!.slice(0, 300)}`;
}

/** Errors first, then by file and line; at most `max`, with a count of the rest. */
export function listProblems(problems: Problem[], max: number): string {
    const sorted = [...problems].sort(
        (a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1) || a.file.localeCompare(b.file) || a.line - b.line,
    );
    const shown = sorted.slice(0, max).map(problemLine);
    if (sorted.length > max) {
        shown.push(`… and ${sorted.length - max} more.`);
    }
    return shown.join('\n');
}

/**
 * The note added to an edit's result. `fresh` errors are the ones this edit
 * introduced; when the file had not been checked before, every error is
 * shown, since there is nothing to compare with.
 */
export function editNote(errors: Problem[], baseline: boolean): string | undefined {
    if (!errors.length) {
        return undefined;
    }
    const count = `${errors.length} ${baseline ? 'new ' : ''}error${errors.length === 1 ? '' : 's'}`;
    return [
        `The editor reports ${count} in the changed file${new Set(errors.map((e) => e.file)).size === 1 ? '' : 's'}:`,
        listProblems(errors, 12),
        baseline ? 'Fix them before going on.' : 'Fix the ones your change caused before going on.',
    ].join('\n');
}
