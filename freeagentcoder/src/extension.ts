import * as vscode from 'vscode';
import { Controller } from './controller';
import { ASK_COMMAND, FIX_COMMAND, FixProvider, fixRequest, selectionReference } from './editorActions';
import { readHandoff } from './handoff/task';
import { noteInstall } from './updates';
import { ChatViewProvider } from './webview/chatView';

export function activate(context: vscode.ExtensionContext): void {
    // Read before the controller records this version as seen.
    const install = noteInstall(context);
    const controller = new Controller(context);
    const view = new ChatViewProvider(context.extensionUri, controller);

    context.subscriptions.push(
        controller,
        vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, view, {
            webviewOptions: { retainContextWhenHidden: true },
        }),
        vscode.window.registerWebviewViewProvider(ChatViewProvider.leftViewType, view, {
            webviewOptions: { retainContextWhenHidden: true },
        }),
        // Brings back the chat tab that was open when VS Code closed.
        vscode.window.registerWebviewPanelSerializer(ChatViewProvider.panelType, view),
        vscode.commands.registerCommand('freeagentcoder.openInEditor', () => view.openInEditor()),
        vscode.commands.registerCommand('freeagentcoder.open', () => view.show({ type: 'focusInput' })),
        vscode.commands.registerCommand('freeagentcoder.newChat', async () => {
            await controller.handle({ type: 'newChat' });
            await view.show({ type: 'focusInput' });
        }),
        vscode.commands.registerCommand('freeagentcoder.manageKeys', () => view.show({ type: 'showSettings', section: 'keys' })),
        vscode.commands.registerCommand('freeagentcoder.showUsage', () => view.show({ type: 'showSettings', section: 'usage' })),
        vscode.commands.registerCommand('freeagentcoder.plans', () => view.show({ type: 'showSettings', section: 'plans' })),
        vscode.commands.registerCommand('freeagentcoder.stop', () => controller.handle({ type: 'stop' })),
        vscode.commands.registerCommand('freeagentcoder.telemetry', () => controller.chooseTelemetry()),
        vscode.commands.registerCommand('freeagentcoder.runLabTask', () => controller.runLabTask()),
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
        vscode.languages.registerCodeActionsProvider({ scheme: 'file' }, new FixProvider(), { providedCodeActionKinds: FixProvider.kinds }),
        vscode.commands.registerCommand(FIX_COMMAND, async (uri?: vscode.Uri, diagnostic?: vscode.Diagnostic) => {
            const text = fixRequest(uri, diagnostic);
            if (!text) {
                void vscode.window.showInformationMessage('FreeAgentCoder: there is no error here to fix.');
                return;
            }
            // While a task runs, the request waits in the input instead of interrupting it.
            if (controller.busy) {
                await view.show({ type: 'focusInput', prefill: text, note: 'Send it when the current task finishes.' });
                return;
            }
            await view.show({ type: 'focusInput' });
            await controller.handle({ type: 'send', text });
        }),
        vscode.commands.registerCommand(ASK_COMMAND, () => view.show({ type: 'focusInput', prefill: selectionReference() })),
        vscode.commands.registerCommand('freeagentcoder.getStarted', () =>
            vscode.commands.executeCommand('workbench.action.openWalkthrough', `${context.extension.id}#getStarted`, false),
        ),
    );

    controller.init().catch((error) => console.error('FreeAgentCoder: could not migrate saved keys', error));

    // Always on screen, bottom right, like the other agents: one click opens the chat wherever it was last.
    const status = vscode.window.createStatusBarItem('freeagentcoder.status', vscode.StatusBarAlignment.Right, 100);
    status.name = 'FreeAgentCoder';
    status.text = '$(hubot) FreeAgentCoder';
    status.tooltip = 'Open the FreeAgentCoder chat';
    status.command = 'freeagentcoder.open';
    status.show();
    context.subscriptions.push(status);

    // A new install (or a reinstall) opens the chat on the left, where its icon is, and says where to find it from now on,
    // so nobody is left wondering whether it installed.
    void install.then(async (kind) => {
        if (kind !== 'new') {
            return;
        }
        await vscode.commands.executeCommand(`${ChatViewProvider.leftViewType}.focus`).then(undefined, () => undefined);
        await vscode.commands.executeCommand('workbench.action.openWalkthrough', `${context.extension.id}#getStarted`, false).then(undefined, () => undefined);
        const choice = await vscode.window.showInformationMessage(
            'FreeAgentCoder is installed. Find it any time on the left bar, with the button at the top right of any editor, or at the bottom right.',
            'Open the chat',
            'Open in a tab',
        );
        if (choice === 'Open the chat') {
            await vscode.commands.executeCommand(`${ChatViewProvider.leftViewType}.focus`);
        } else if (choice === 'Open in a tab') {
            view.openInEditor();
        }
    });
}

export function deactivate(): void {}
