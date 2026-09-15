import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { Controller } from '../controller';
import type { FromWebview, ToWebview } from '../shared/protocol';

/** Messages worth holding until the webview has loaded; transcript events are replayed instead. */
const QUEUED_TYPES = new Set<ToWebview['type']>(['showSettings', 'focusInput']);

export class ChatViewProvider implements vscode.WebviewViewProvider {
    static readonly viewType = 'freeagentcoder.chat';

    private view?: vscode.WebviewView;
    private ready = false;
    private pending: ToWebview[] = [];

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly controller: Controller,
    ) {
        controller.attach({ post: (message) => this.post(message) });
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        this.ready = false;
        const dist = vscode.Uri.joinPath(this.extensionUri, 'dist');
        view.webview.options = { enableScripts: true, localResourceRoots: [dist] };
        view.webview.html = renderHtml(view.webview, dist);

        view.webview.onDidReceiveMessage(async (message: FromWebview) => {
            if (message?.type === 'ready') {
                this.ready = true;
                await this.controller.handle(message);
                const pending = this.pending;
                this.pending = [];
                for (const queued of pending) {
                    void view.webview.postMessage(queued);
                }
                return;
            }
            await this.controller.handle(message);
        });

        view.onDidDispose(() => {
            if (this.view === view) {
                this.view = undefined;
                this.ready = false;
            }
        });
    }

    async show(message?: ToWebview): Promise<void> {
        if (message) {
            this.post(message);
        }
        await vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
    }

    private post(message: ToWebview): void {
        if (this.view && this.ready) {
            void this.view.webview.postMessage(message);
        } else if (QUEUED_TYPES.has(message.type)) {
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
