import * as vscode from 'vscode';
import { Controller } from './controller';
import { readHandoff } from './handoff/task';
import { ChatViewProvider } from './webview/chatView';

export function activate(context: vscode.ExtensionContext): void {
    const controller = new Controller(context);
    const view = new ChatViewProvider(context.extensionUri, controller);

    context.subscriptions.push(
        controller,
        vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, view, {
            webviewOptions: { retainContextWhenHidden: true },
        }),
        vscode.commands.registerCommand('freeagentcoder.open', () => view.show({ type: 'focusInput' })),
        vscode.commands.registerCommand('freeagentcoder.newChat', async () => {
            await controller.handle({ type: 'newChat' });
            await view.show({ type: 'focusInput' });
        }),
        vscode.commands.registerCommand('freeagentcoder.manageKeys', () => view.show({ type: 'showSettings', section: 'keys' })),
        vscode.commands.registerCommand('freeagentcoder.showUsage', () => view.show({ type: 'showSettings', section: 'usage' })),
        vscode.commands.registerCommand('freeagentcoder.stop', () => controller.handle({ type: 'stop' })),
        vscode.commands.registerCommand('freeagentcoder.telemetry', () => controller.chooseTelemetry()),
        vscode.commands.registerCommand('freeagentcoder.testProject', async () => {
            await view.show({ type: 'focusInput' });
            await controller.handle({ type: 'testProject' });
        }),
        // vscode://PrateekKoratala.freeagentcoder/task?p=… from Project Brain.
        vscode.window.registerUriHandler({
            handleUri: async (uri) => {
                const result = readHandoff(uri.path, uri.query, vscode.workspace.workspaceFolders?.[0]?.name);
                if (!result.ok) {
                    void vscode.window.showErrorMessage(`FreeAgentCoder: ${result.error}`);
                    return;
                }
                await view.show({ type: 'focusInput', prefill: result.task.brief, note: result.note });
            },
        }),
        vscode.commands.registerCommand('freeagentcoder.getStarted', () =>
            vscode.commands.executeCommand('workbench.action.openWalkthrough', `${context.extension.id}#getStarted`, false),
        ),
    );

    controller.init().catch((error) => console.error('FreeAgentCoder: could not migrate saved keys', error));
}

export function deactivate(): void {}
