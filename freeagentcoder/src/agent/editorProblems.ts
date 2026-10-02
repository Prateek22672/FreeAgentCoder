import * as path from 'node:path';
import * as vscode from 'vscode';
import { toolError, type Tool } from '@agentic/core';
import { CHECKED_FILES, editNote, introduced, listProblems, type Problem } from './problems';

/** Waiting for a language server: for its first report, then for it to go quiet, and never longer than the cap. */
const FIRST_REPORT_MS = 2_000;
const SETTLE_MS = 350;
const MAX_WAIT_MS = 4_000;

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
function settled(uris: vscode.Uri[], signal: AbortSignal): Promise<boolean> {
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
        const first = setTimeout(finish, FIRST_REPORT_MS);
        const cap = setTimeout(finish, MAX_WAIT_MS);
        signal.addEventListener('abort', finish, { once: true });
    });
}

/**
 * After the agent edits files, the errors the editor finds in them. The files
 * are opened (not shown) so their language server checks them; only errors the
 * change introduced are reported, so the model fixes them while the change is
 * fresh instead of finding them at the end.
 */
export function editorProblemsAfterEdit(root: string): (paths: string[], signal: AbortSignal) => Promise<string | undefined> {
    return async (paths, signal) => {
        const uris = paths.filter((p) => CHECKED_FILES.test(p)).map((p) => vscode.Uri.file(p));
        if (!uris.length) {
            return undefined;
        }
        // Read before the language server catches up: this is the file as it was checked before the edit.
        const open = new Set(vscode.workspace.textDocuments.map((d) => d.uri.toString()));
        const before = uris.flatMap((u) => problemsOf(root, u, vscode.languages.getDiagnostics(u), false));
        const baseline = uris.every((u) => open.has(u.toString()));
        const waiting = settled(uris, signal);
        await Promise.all(uris.map((u) => vscode.workspace.openTextDocument(u).then(undefined, () => undefined)));
        if (!(await waiting) || signal.aborted) {
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
                        const waiting = settled([uri], ctx.signal);
                        await vscode.workspace.openTextDocument(uri).then(undefined, () => undefined);
                        if (!vscode.languages.getDiagnostics(uri).length) {
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
