import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { Controller } from '../controller';
import type { FromWebview, ToWebview } from '../shared/protocol';

/** Messages worth holding until a webview has loaded; transcript events are replayed instead. */
const QUEUED_TYPES = new Set<ToWebview['type']>(['showSettings', 'focusInput']);

interface Surface {
    webview: vscode.Webview;
    ready: boolean;
    pending: ToWebview[];
    /** How to bring it to the front. */
    reveal: () => Thenable<unknown> | void;
}

/**
 * Every place the chat can be shown, all showing the same live chat:
 *
 * - a view on the left activity bar, always one click away;
 * - a view in the right sidebar (the secondary side bar);
 * - an editor tab, opened from the button at the top right of every editor.
 *   VS Code reopens it after a restart, so it stays where it was left.
 *
 * Messages from the extension go to every open surface. A surface that has
 * just loaded gets the conversation replayed to it alone, so the others do
 * not see it twice.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.WebviewPanelSerializer {
    static readonly viewType = 'freeagentcoder.chat';
    static readonly leftViewType = 'freeagentcoder.sidebar';
    static readonly panelType = 'freeagentcoder.panel';

    private readonly surfaces = new Set<Surface>();
    /** While a surface is being caught up, messages go to it alone. */
    private only?: Surface;
    /** Waiting for any surface to open. */
    private pending: ToWebview[] = [];
    private panel?: vscode.WebviewPanel;
    /** The surface used last, which is where commands bring the chat. */
    private last?: Surface;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly controller: Controller,
    ) {
        controller.attach({ post: (message) => this.post(message) });
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        const viewId = view.viewType;
        const surface = this.connect(view.webview, () => vscode.commands.executeCommand(`${viewId}.focus`));
        view.onDidChangeVisibility(() => {
            if (view.visible) {
                this.last = surface;
            }
        });
        view.onDidDispose(() => this.disconnect(surface));
    }

    /** Called by VS Code on start-up for a tab that was open when it closed. */
    async deserializeWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
        this.adopt(panel);
    }

    /** Opens the chat as an editor tab beside the current editor, or brings the open one forward. */
    openInEditor(): void {
        if (this.panel) {
            this.panel.reveal(undefined, false);
            return;
        }
        const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
        const panel = vscode.window.createWebviewPanel(ChatViewProvider.panelType, 'FreeAgentCoder', { viewColumn: column, preserveFocus: false }, { retainContextWhenHidden: true });
        this.adopt(panel);
    }

    async show(message?: ToWebview): Promise<void> {
        if (message) {
            this.post(message);
        }
        const target = this.last && this.surfaces.has(this.last) ? this.last : undefined;
        if (target) {
            await target.reveal();
        } else {
            await vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
        }
    }

    private adopt(panel: vscode.WebviewPanel): void {
        this.panel = panel;
        panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'icon-accent.svg');
        const surface = this.connect(panel.webview, () => panel.reveal(undefined, false));
        this.last = surface;
        panel.onDidChangeViewState(() => {
            if (panel.active) {
                this.last = surface;
            }
        });
        panel.onDidDispose(() => {
            this.disconnect(surface);
            if (this.panel === panel) {
                this.panel = undefined;
            }
        });
    }

    private connect(webview: vscode.Webview, reveal: Surface['reveal']): Surface {
        const surface: Surface = { webview, ready: false, pending: [], reveal };
        this.surfaces.add(surface);
        const dist = vscode.Uri.joinPath(this.extensionUri, 'dist');
        webview.options = { enableScripts: true, localResourceRoots: [dist] };
        webview.html = renderHtml(webview, dist);

        webview.onDidReceiveMessage(async (message: FromWebview) => {
            this.last = surface;
            if (message?.type === 'ready') {
                surface.ready = true;
                // The conversation is replayed synchronously at the start of handling "ready": send that part to this surface alone.
                this.only = surface;
                const handled = this.controller.handle(message);
                this.only = undefined;
                await handled;
                const queued = [...this.pending, ...surface.pending];
                this.pending = [];
                surface.pending = [];
                for (const item of queued) {
                    void webview.postMessage(item);
                }
                return;
            }
            await this.controller.handle(message);
        });
        return surface;
    }

    private disconnect(surface: Surface): void {
        this.surfaces.delete(surface);
        if (this.last === surface) {
            this.last = undefined;
        }
    }

    private post(message: ToWebview): void {
        if (this.only) {
            void this.only.webview.postMessage(message);
            return;
        }
        let delivered = false;
        for (const surface of this.surfaces) {
            if (surface.ready) {
                void surface.webview.postMessage(message);
                delivered = true;
            } else if (QUEUED_TYPES.has(message.type)) {
                surface.pending.push(message);
                delivered = true;
            }
        }
        if (!delivered && QUEUED_TYPES.has(message.type)) {
            this.pending.push(message);
        }
    }
}

function renderHtml(webview: vscode.Webview, dist: vscode.Uri): string {
    const nonce = randomBytes(16).toString('hex');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.css'));
    const csp = [
        "default-src 'none'",
        `img-src ${webview.cspSource} data:`,
        `style-src ${webview.cspSource}`,
        `font-src ${webview.cspSource}`,
        `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
<title>FreeAgentCoder</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
