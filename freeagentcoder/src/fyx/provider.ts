import type { ChatRequest, Message, Provider, StreamEvent, ToolCall } from '@agentic/core';
import type { FyxPlan } from './plan';

export const FYX_PROVIDER = 'fyx';
export const FYX_MODEL = 'fyx-1';

/**
 * Plays a Fyx plan through the agent loop as if it were a model: one
 * run_command call per step, then a closing message. No network, no tokens.
 * Each step waits for the previous one's result; a step that fails, is denied
 * or is stopped ends the task with what happened and how to carry on.
 */
export class FyxProvider implements Provider {
    readonly id = FYX_PROVIDER;

    constructor(
        private readonly plan: FyxPlan,
        /** The closing line: what was saved by not asking a model. */
        private readonly savedNote = 'Fyx did this on your machine without an AI model, so it used no tokens.',
    ) {}

    async listModels(): Promise<string[]> {
        return [FYX_MODEL];
    }

    async *stream(req: ChatRequest): AsyncGenerator<StreamEvent> {
        const since = lastUserIndex(req.messages);
        const done = req.messages.slice(since + 1).filter((m) => m.role === 'tool');
        const last = done.at(-1);
        if (last && !succeeded(last.content)) {
            yield* say(failure(this.plan, done.length, last.content));
            return;
        }
        const next = this.plan.steps[done.length];
        if (!next) {
            yield* say(`${this.plan.done}\n\n${this.savedNote}`);
            return;
        }
        const call: ToolCall = {
            id: `fyx${done.length}${Math.random().toString(36).slice(2, 8)}`,
            name: 'run_command',
            args: { command: next.command, ...(next.background ? { background: true } : {}), ...(next.timeout ? { timeout: next.timeout } : {}) },
        };
        yield { type: 'tool_call', name: 'run_command' };
        yield {
            type: 'done',
            stopReason: 'tool_use',
            message: { role: 'assistant', content: done.length === 0 ? this.plan.intro : '', toolCalls: [call], model: `${FYX_PROVIDER}:${FYX_MODEL}` },
        };
    }
}

function lastUserIndex(messages: Message[]): number {
    for (let i = messages.length - 1; i >= 0; i--) {if (messages[i]!.role === 'user') {return i;}}
    return -1;
}

/** run_command answers "Exit code: 0" first when it worked; background starts say they started. */
function succeeded(content: string): boolean {
    return /^Exit code: 0\b/.test(content) || /^Started background process\b/.test(content);
}

function failure(plan: FyxPlan, step: number, content: string): string {
    const first = content.split('\n').filter(Boolean).slice(0, 6).join('\n');
    const denied = /declined|denied|not approved|refused/i.test(content);
    return denied
        ? `Stopped: step ${step} was not approved, so nothing more was run.`
        : `Fyx could not finish this (${plan.kind}): step ${step} failed.\n\n\`\`\`\n${first}\n\`\`\`\n\nSay **continue** and the AI agent will take it from here, with this output in front of it.`;
}

async function* say(text: string): AsyncGenerator<StreamEvent> {
    yield { type: 'text', delta: text };
    yield { type: 'done', stopReason: 'stop', message: { role: 'assistant', content: text, model: `${FYX_PROVIDER}:${FYX_MODEL}` } };
}
