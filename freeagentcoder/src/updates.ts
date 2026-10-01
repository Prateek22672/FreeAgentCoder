import * as vscode from 'vscode';

/**
 * Two small, one-time notices, so people know what they have:
 *  - after an update, what is new in it (once per version);
 *  - when a newer version is out, that it is (once per version), with a
 *    button to update.
 * Neither appears on a fresh install, which has its own Get started guide.
 */

const SEEN = 'freeagentcoder.lastVersion';
const TOLD_LATEST = 'freeagentcoder.toldLatest';
const EXTENSION_ID = 'PrateekKoratala.freeagentcoder';

/** One line per release, in plain words. Only the current version's is shown. */
const WHATS_NEW: Record<string, string> = {
    '0.4.0':
        'FreeAgentCoder 0.4.0: Fyx does everyday chores (zip, git, install, run your project) in seconds with zero tokens, tasks work with no key on the free trial, and the free keys that work are listed plainly.',
};

/** True when version a is newer than b ("0.4.1" > "0.4.0"). */
export function isNewer(a: string, b: string): boolean {
    const pa = a.split('.').map((n) => Number(n) || 0);
    const pb = b.split('.').map((n) => Number(n) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        if ((pa[i] ?? 0) !== (pb[i] ?? 0)) {
            return (pa[i] ?? 0) > (pb[i] ?? 0);
        }
    }
    return false;
}

export function showWhatsNew(context: vscode.ExtensionContext): void {
    const current = String(context.extension.packageJSON.version ?? '');
    const previous = context.globalState.get<string>(SEEN);
    void context.globalState.update(SEEN, current);
    if (!previous || previous === current || !WHATS_NEW[current]) {
        return;
    }
    void vscode.window.showInformationMessage(WHATS_NEW[current]!, 'See what’s new').then((choice) => {
        if (choice) {
            void vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.joinPath(context.extensionUri, 'CHANGELOG.md'));
        }
    });
}

/** Called with the latest version the site reports. */
export function tellIfOutdated(context: vscode.ExtensionContext, latest: string | undefined): void {
    const current = String(context.extension.packageJSON.version ?? '');
    if (!latest || !/^\d+\.\d+\.\d+$/.test(latest) || !isNewer(latest, current) || context.globalState.get<string>(TOLD_LATEST) === latest) {
        return;
    }
    void context.globalState.update(TOLD_LATEST, latest);
    void vscode.window.showInformationMessage(`FreeAgentCoder ${latest} is available. You have ${current}.`, 'Update').then((choice) => {
        if (choice) {
            void vscode.commands.executeCommand('workbench.extensions.action.showExtensionsWithIds', [EXTENSION_ID]);
        }
    });
}
