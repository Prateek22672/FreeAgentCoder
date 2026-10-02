import * as vscode from 'vscode';

/**
 * Two small, one-time notices, so people know what they have:
 *  - after an update, what is new in it (once per version);
 *  - when a newer version is out, that it is (once per version), with a
 *    button to update.
 * Neither appears on a fresh install, which has its own Get started guide.
 */

const SEEN = 'freeagentcoder.lastVersion';
const INSTALLED = 'freeagentcoder.installedAt';
const TOLD_LATEST = 'freeagentcoder.toldLatest';
const EXTENSION_ID = 'PrateekKoratala.freeagentcoder';

/** One line per release, in plain words. Only the current version's is shown. */
const WHATS_NEW: Record<string, string> = {
    '0.4.0':
        'FreeAgentCoder 0.4.0: Fyx does everyday chores (zip, git, install, run your project) in seconds with zero tokens, tasks work with no key on the free trial, and the free keys that work are listed plainly.',
    '0.4.2':
        'FreeAgentCoder 0.4.2: small builds stay small (a browser game is plain HTML, not a framework set-up), web pages are run in a hidden browser before they are called done, a preview opens when a task ends, and a task pauses at 500K tokens before it can use up your day.',
};

/**
 * Whether this is a new install: the first ever, or a reinstall. An update
 * is not: it has its own "what is new" note.
 *
 * `installedAt` is when the extension's folder was created, which changes
 * with every install; `previousVersion` is the version last run here.
 */
export function installKind(installedAt: number, seenInstalledAt: number | undefined, version: string, previousVersion: string | undefined): 'new' | 'update' | 'same' {
    if (seenInstalledAt === installedAt) {
        return 'same';
    }
    return previousVersion && previousVersion !== version ? 'update' : 'new';
}

/** Notes this install, and says whether it is a new one. Call before showWhatsNew, which records the version. */
export async function noteInstall(context: vscode.ExtensionContext): Promise<'new' | 'update' | 'same'> {
    // Read now, before anything is awaited: showWhatsNew overwrites the version as soon as the controller starts.
    const previousVersion = context.globalState.get<string>(SEEN);
    const seenInstalledAt = context.globalState.get<number>(INSTALLED);
    let installedAt = 0;
    try {
        installedAt = Math.round((await vscode.workspace.fs.stat(context.extensionUri)).ctime);
    } catch {
        return 'same';
    }
    const kind = installKind(installedAt, seenInstalledAt, String(context.extension.packageJSON.version ?? ''), previousVersion);
    await context.globalState.update(INSTALLED, installedAt);
    return kind;
}

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
