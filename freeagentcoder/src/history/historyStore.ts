import * as vscode from 'vscode';
import { stripImageData, type Message, type Todo } from '@agentic/core';
import type { ChatSummary, ToWebview } from '../shared/protocol';

export interface ChatRecord extends ChatSummary {
    messages: Message[];
    todos: Todo[];
    transcript: ToWebview[];
}

const MAX_CHATS = 200;
const MAX_TOOL_CHARS = 4_000;
const MAX_TRANSCRIPT = 5_000;
/** Chat ids become file names, so anything else (e.g. a crafted "../") is refused. */
const SAFE_ID = /^[\w-]{1,80}$/;

export function newChatId(): string {
    return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Saved conversations, one JSON file each, in the extension's local storage folder. */
export class HistoryStore {
    private readonly dir: vscode.Uri;
    private index?: ChatSummary[];
    private queue: Promise<unknown> = Promise.resolve();

    constructor(storage: vscode.Uri) {
        this.dir = vscode.Uri.joinPath(storage, 'history');
    }

    async list(): Promise<ChatSummary[]> {
        if (!this.index) {
            try {
                const parsed = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(this.indexUri())).toString('utf8')) as unknown;
                this.index = Array.isArray(parsed) ? (parsed as ChatSummary[]) : [];
            } catch {
                this.index = [];
            }
        }
        return [...this.index].sort((a, b) => b.updatedAt - a.updatedAt);
    }

    async load(id: string): Promise<ChatRecord | undefined> {
        if (!SAFE_ID.test(id)) {
            return undefined;
        }
        try {
            return JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(this.fileUri(id))).toString('utf8')) as ChatRecord;
        } catch {
            return undefined;
        }
    }

    save(record: ChatRecord): Promise<void> {
        return this.serial(async () => {
            if (!SAFE_ID.test(record.id)) {
                return;
            }
            await vscode.workspace.fs.createDirectory(this.dir);
            const slim: ChatRecord = {
                ...record,
                // Screenshots are kept as names only; their base64 would bloat every saved chat.
                messages: stripImageData(record.messages).map((m) =>
                    m.role === 'tool' && m.content.length > MAX_TOOL_CHARS
                        ? { ...m, content: `${m.content.slice(0, MAX_TOOL_CHARS)}\n… [trimmed when the chat was saved]` }
                        : m,
                ),
                transcript: record.transcript.filter((m) => m.type !== 'toolOutput' && m.type !== 'reasoning').slice(-MAX_TRANSCRIPT),
            };
            await vscode.workspace.fs.writeFile(this.fileUri(record.id), Buffer.from(JSON.stringify(slim), 'utf8'));

            const summary: ChatSummary = {
                id: record.id,
                title: record.title,
                workspace: record.workspace,
                createdAt: record.createdAt,
                updatedAt: record.updatedAt,
                turns: record.turns,
            };
            const index = [summary, ...(await this.list()).filter((c) => c.id !== record.id)];
            for (const old of index.slice(MAX_CHATS)) {
                await this.removeFile(old.id);
            }
            this.index = index.slice(0, MAX_CHATS);
            await this.writeIndex();
        });
    }

    delete(id: string): Promise<void> {
        return this.serial(async () => {
            if (!SAFE_ID.test(id)) {
                return;
            }
            await this.removeFile(id);
            this.index = (await this.list()).filter((c) => c.id !== id);
            await this.writeIndex();
        });
    }

    clear(): Promise<void> {
        return this.serial(async () => {
            try {
                await vscode.workspace.fs.delete(this.dir, { recursive: true, useTrash: false });
            } catch {
                // Nothing was saved yet.
            }
            this.index = [];
        });
    }

    private async removeFile(id: string): Promise<void> {
        try {
            await vscode.workspace.fs.delete(this.fileUri(id));
        } catch {
            // Already gone.
        }
    }

    private async writeIndex(): Promise<void> {
        await vscode.workspace.fs.createDirectory(this.dir);
        await vscode.workspace.fs.writeFile(this.indexUri(), Buffer.from(JSON.stringify(this.index ?? []), 'utf8'));
    }

    private indexUri(): vscode.Uri {
        return vscode.Uri.joinPath(this.dir, 'index.json');
    }

    private fileUri(id: string): vscode.Uri {
        return vscode.Uri.joinPath(this.dir, `${id}.json`);
    }

    private serial<T>(task: () => Promise<T>): Promise<T> {
        const run = this.queue.then(task, task);
        this.queue = run.catch(() => undefined);
        return run;
    }
}
