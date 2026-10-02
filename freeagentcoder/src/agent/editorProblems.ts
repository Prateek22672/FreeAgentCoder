import * as path from 'node:path';
import * as vscode from 'vscode';
import { toolError, type Tool } from '@agentic/core';
import { CHECKED_FILES, editNote, introduced, listProblems, type Problem } from './problems';

/**
 * Waiting for a language server: for its first report (longer when the file has
 * just been put in a tab, as a server may be starting), then for it to go
 * quiet, and never longer than the cap.
 */
const FIRST_REPORT_MS = 2_000;
const FIRST_REPORT_SHOWN_MS = 5_000;
const SETTLE_MS = 350;
const MAX_WAIT_MS = 6_000;
/** File types whose language server has not answered this many times in a row are no longer waited on. */
const MAX_MISSES = 2;

function problemsOf(root: string, uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[], warnings: boolean): Problem[] {
    const file = path.relative(root, uri.fsPath).split(path.sep).join('/');
    return diagnostics
        .filter((d) => d.severity === vscode.DiagnosticSeverity.Error || (warnings && d.severity === vscode.DiagnosticSeverity.Warning))
        .map((d) => ({
            file,
            line: d.range.start.line + 1,
            column: d.range.start.character + 1,
            severity: d.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning',
            message: d.message,
            source: d.source,
            code: typeof d.code === 'object' ? String(d.code.value) : d.code !== undefined ? String(d.code) : undefined,
        }));
}

/** Resolves once diagnostics for these files have been reported and gone quiet, or the wait runs out. */
function settled(uris: vscode.Uri[], signal: AbortSignal, firstReportMs = FIRST_REPORT_MS): Promise<boolean> {
    const watched = new Set(uris.map((u) => u.toString()));
    return new Promise((resolve) => {
        let reported = false;
        let quiet: ReturnType<typeof setTimeout> | undefined;
        const finish = () => {
            clearTimeout(first);
            clearTimeout(cap);
            clearTimeout(quiet);
            listener.dispose();
            signal.removeEventListener('abort', finish);
            resolve(reported);
        };
        const listener = vscode.languages.onDidChangeDiagnostics((event) => {
            if (event.uris.some((u) => watched.has(u.toString()))) {
                reported = true;
                clearTimeout(first);
                clearTimeout(quiet);
                quiet = setTimeout(finish, SETTLE_MS);
            }
        });
        const first = setTimeout(finish, firstReportMs);
        const cap = setTimeout(finish, MAX_WAIT_MS);
        signal.addEventListener('abort', finish, { once: true });
    });
}

function inTab(uri: vscode.Uri): boolean {
    const target = uri.toString();
    return vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === target));
}

/**
 * Puts a file in a preview tab without taking focus. Language servers (the
 * TypeScript one among them) only check files shown in a tab; a preview tab is
 * reused by the next one, so tabs do not pile up.
 */
async function showQuietly(uri: vscode.Uri): Promise<boolean> {
    try {
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document, { preview: true, preserveFocus: true });
        return true;
    } catch {
        return false;
    }
}

const typeOf = (uri: vscode.Uri) => path.extname(uri.fsPath).toLowerCase();

/**
 * After the agent edits files, the errors the editor finds in them, so the
 * model fixes them while the change is fresh instead of finding them at the
 * end. A file not in a tab is shown in a preview tab so it gets checked. When
 * the file was already checked, only errors the change introduced are
 * reported.
 */
export function editorProblemsAfterEdit(root: string, enabled: () => boolean = () => true): (paths: string[], signal: AbortSignal) => Promise<string | undefined> {
    const misses = new Map<string, number>();
    return async (paths, signal) => {
        if (!enabled()) {
            return undefined;
        }
        const candidates = paths
            .filter((p) => CHECKED_FILES.test(p))
            .map((p) => vscode.Uri.file(p))
            .filter((u) => (misses.get(typeOf(u)) ?? 0) < MAX_MISSES);
        // Files already in a tab are checked as they are; of the rest, the first is shown (a second would replace it).
        const tabbed = candidates.filter(inTab);
        const shown = candidates.find((u) => !inTab(u));
        const uris = shown ? [...tabbed, shown] : tabbed;
        if (!uris.length) {
            return undefined;
        }
        // Read before the language server catches up: for a file in a tab, this is how it was checked before the edit.
        const before = tabbed.flatMap((u) => problemsOf(root, u, vscode.languages.getDiagnostics(u), false));
        const baseline = !shown;
        const waiting = settled(uris, signal, shown ? FIRST_REPORT_SHOWN_MS : FIRST_REPORT_MS);
        if (shown && !(await showQuietly(shown))) {
            uris.pop();
        }
        const reported = await waiting;
        for (const u of uris) {
            misses.set(typeOf(u), reported ? 0 : (misses.get(typeOf(u)) ?? 0) + 1);
        }
        if (!reported || signal.aborted) {
            return undefined;
        }
        const after = uris.flatMap((u) => problemsOf(root, u, vscode.languages.getDiagnostics(u), false));
        return editNote(baseline ? introduced(before, after) : after, baseline);
    };
}

/** The agent's way to ask what the editor reports, for one file or the whole project. */
export function getProblemsTool(): Tool<{ path?: string; warnings?: boolean }> {
    return {
        name: 'get_problems',
        description:
            "The errors (and, with warnings=true, warnings) that the editor's language servers report: type errors, lint and syntax errors, with file and line. Faster than running a type check or build. Give a path for one file (it is opened and checked); leave it out for every file the editor has checked so far.",
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'A file, relative to the project root. Leave out for the whole project.' },
                warnings: { type: 'boolean', description: 'Include warnings. Default false.' },
            },
        },
        kind: 'read',
        label: (args) => (args.path ? `Problems in ${args.path}` : 'Problems in the project'),
        paths: (args, workspace) => (args.path ? [workspace.resolve(args.path)] : []),
        async prepare(args, ctx) {
            const workspace = ctx.workspace;
            const file = args.path ? workspace.resolve(args.path) : undefined;
            if (file && (await workspace.stat(file))?.type !== 'file') {
                return toolError(`${workspace.relative(file)} does not exist.`);
            }
            return {
                run: async () => {
                    let problems: Problem[];
                    if (file) {
                        const uri = vscode.Uri.file(file);
                        const waiting = settled([uri], ctx.signal, FIRST_REPORT_SHOWN_MS);
                        if (!inTab(uri)) {
                            await showQuietly(uri);
                            await waiting;
                        } else if (!vscode.languages.getDiagnostics(uri).length) {
                            await waiting;
                        }
                        problems = problemsOf(workspace.root, uri, vscode.languages.getDiagnostics(uri), !!args.warnings);
                    } else {
                        problems = vscode.languages
                            .getDiagnostics()
                            .filter(([uri]) => uri.scheme === 'file' && workspace.isInside(uri.fsPath) && !/[\\/]node_modules[\\/]/.test(uri.fsPath))
                            .flatMap(([uri, list]) => problemsOf(workspace.root, uri, list, !!args.warnings));
                    }
                    const errors = problems.filter((p) => p.severity === 'error').length;
                    const where = args.path ?? 'the files the editor has checked';
                    return {
                        content: problems.length ? listProblems(problems, 60) : `No ${args.warnings ? 'errors or warnings' : 'errors'} reported in ${where}.`,
                        summary: problems.length ? `${errors} error${errors === 1 ? '' : 's'}${problems.length > errors ? `, ${problems.length - errors} warnings` : ''}` : 'none',
                    };
                },
            };
        },
    };
}
