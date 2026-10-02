import * as vscode from 'vscode';

/**
 * Ways into the agent from the code itself: a "Fix with FreeAgentCoder" quick
 * fix on an error, and "Ask FreeAgentCoder" on a selection, which puts a
 * reference to the selected lines in the chat input.
 */

export const FIX_COMMAND = 'freeagentcoder.fixProblem';
export const ASK_COMMAND = 'freeagentcoder.askAboutSelection';

/** A reference the agent can read: `src/app.ts:12` or `src/app.ts:12-20`. */
export function codeReference(file: string, startLine: number, endLine = startLine): string {
    return `\`${file}:${startLine}${endLine > startLine ? `-${endLine}` : ''}\``;
}

export function fixPrompt(file: string, line: number, message: string, source?: string, code?: string): string {
    const tag = [source, code].filter(Boolean).join(' ');
    return `Fix this error at ${codeReference(file, line)}${tag ? ` (${tag})` : ''}: ${message.split('\n')[0]}\nFind the cause, fix it with the smallest change, and check the editor reports no new errors.`;
}

export class FixProvider implements vscode.CodeActionProvider {
    static readonly kinds = [vscode.CodeActionKind.QuickFix];

    provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
        const error = context.diagnostics.find((d) => d.severity === vscode.DiagnosticSeverity.Error);
        if (!error || document.uri.scheme !== 'file') {
            return [];
        }
        const action = new vscode.CodeAction('Fix with FreeAgentCoder', vscode.CodeActionKind.QuickFix);
        action.diagnostics = [error];
        action.command = { command: FIX_COMMAND, title: 'Fix with FreeAgentCoder', arguments: [document.uri, error] };
        return [action];
    }
}

function relativeTo(uri: vscode.Uri): string {
    return vscode.workspace.asRelativePath(uri, false);
}

/** The prompt for a fix, from the quick fix's arguments or, from the palette, the first error under the cursor. */
export function fixRequest(uri?: vscode.Uri, diagnostic?: vscode.Diagnostic): string | undefined {
    if (!uri || !diagnostic) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return undefined;
        }
        uri = editor.document.uri;
        const line = editor.selection.active.line;
        diagnostic =
            vscode.languages.getDiagnostics(uri).find((d) => d.severity === vscode.DiagnosticSeverity.Error && d.range.start.line <= line && d.range.end.line >= line) ??
            vscode.languages.getDiagnostics(uri).find((d) => d.severity === vscode.DiagnosticSeverity.Error);
        if (!diagnostic) {
            return undefined;
        }
    }
    const code = typeof diagnostic.code === 'object' ? String(diagnostic.code.value) : diagnostic.code !== undefined ? String(diagnostic.code) : undefined;
    return fixPrompt(relativeTo(uri), diagnostic.range.start.line + 1, diagnostic.message, diagnostic.source, code);
}

/** What "Ask FreeAgentCoder" puts in the input: a reference to the selection, ready for the question. */
export function selectionReference(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
        return undefined;
    }
    const { start, end } = editor.selection;
    // A selection ending at the very start of a line does not include that line.
    const last = end.character === 0 && end.line > start.line ? end.line - 1 : end.line;
    return `${codeReference(relativeTo(editor.document.uri), start.line + 1, last + 1)} `;
}
