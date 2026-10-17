import * as vscode from 'vscode';

const CHAT_PANEL = 'freeagentcoder.panel';

const showsChat = (group: vscode.TabGroup) => {
    const input = group.activeTab?.input;
    return input instanceof vscode.TabInputWebview && input.viewType.includes(CHAT_PANEL);
};

/**
 * Where to show a file, a diff or a preview without covering the chat. With
 * the chat in an editor tab, VS Code's default (the active group) is usually
 * the chat's own group, so whatever opens hides it: use the group of the
 * editor the user was in, another group, or a new one beside the chat. With
 * the chat in the sidebar, nothing changes.
 */
export function besideChat(): vscode.ViewColumn | undefined {
    const groups = vscode.window.tabGroups.all;
    if (!groups.some(showsChat)) {
        return undefined;
    }
    const editor = vscode.window.activeTextEditor?.viewColumn;
    const free = groups.find((g) => g.viewColumn === editor && !showsChat(g)) ?? groups.find((g) => !showsChat(g));
    return free?.viewColumn ?? vscode.ViewColumn.Beside;
}
