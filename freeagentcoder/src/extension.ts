import * as vscode from 'vscode';
import { Controller } from './controller';
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
        vscode.commands.registerCommand('freeagentcoder.testProject', async () => {
            await view.show({ type: 'focusInput' });
            await controller.handle({ type: 'testProject' });
        }),
        vscode.commands.registerCommand('freeagentcoder.getStarted', () =>
            vscode.commands.executeCommand('workbench.action.openWalkthrough', `${context.extension.id}#getStarted`, false),
        ),
    );

    controller.init().catch((error) => console.error('FreeAgentCoder: could not migrate saved keys', error));
}

export function deactivate(): void {}
