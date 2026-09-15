import * as vscode from 'vscode';

export const DIFF_SCHEME = 'freeagentcoder-diff';
const LIMIT = 80;

/** Before/after snapshots of the agent's file changes, served to VS Code's diff editor. */
export class DiffDocuments implements vscode.TextDocumentContentProvider {
    private readonly docs = new Map<string, { before: string; after: string }>();

    set(id: string, before: string, after: string): void {
        this.docs.delete(id);
        this.docs.set(id, { before, after });
        while (this.docs.size > LIMIT) {
            this.docs.delete(this.docs.keys().next().value as string);
        }
    }

    setAfter(id: string, after: string): void {
        const doc = this.docs.get(id);
        if (doc) {
            doc.after = after;
        }
    }

    has(id: string): boolean {
        return this.docs.has(id);
    }

    clear(): void {
        this.docs.clear();
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        const [, side, id] = uri.path.split('/');
        const doc = this.docs.get(id ?? '');
        return side === 'before' ? (doc?.before ?? '') : (doc?.after ?? '');
    }

    async open(id: string, title: string): Promise<boolean> {
        if (!this.docs.has(id)) {
            return false;
        }
        const name = title.split(/[\\/]/).pop() || 'file';
        const left = vscode.Uri.from({ scheme: DIFF_SCHEME, path: `/before/${id}/${name}` });
        const right = vscode.Uri.from({ scheme: DIFF_SCHEME, path: `/after/${id}/${name}` });
        await vscode.commands.executeCommand('vscode.diff', left, right, `${title} (FreeAgentCoder changes)`, { preview: true });
        return true;
    }
}
