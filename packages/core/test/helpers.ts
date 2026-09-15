import type { AgentEvent } from '../src/agent/agent';
import type { ChatRequest, Provider, StreamEvent } from '../src/providers/types';
import type { AssistantMessage, ToolCall } from '../src/types';
import { toolCallId } from '../src/util/ids';

export type Step = (req: ChatRequest) => AssistantMessage | Error;

/** A fake model that replays a script, one step per model call. */
export class ScriptedProvider implements Provider {
  readonly requests: ChatRequest[] = [];
  constructor(
    private readonly script: Step[],
    readonly id = 'mock',
  ) {}

  async *stream(req: ChatRequest): AsyncGenerator<StreamEvent> {
    this.requests.push(JSON.parse(JSON.stringify({ ...req, signal: undefined })) as ChatRequest);
    const step = this.script.shift();
    if (!step) throw new Error('script exhausted');
    const result = step(req);
    if (result instanceof Error) throw result;
    if (result.content) yield { type: 'text', delta: result.content };
    yield { type: 'done', message: result, stopReason: result.stop ?? (result.toolCalls?.length ? 'tool_use' : 'stop') };
  }

  async listModels(): Promise<string[]> {
    return [];
  }

  get remaining(): number {
    return this.script.length;
  }
}

export function say(text: string): Step {
  return () => ({ role: 'assistant', content: text });
}

export function call(name: string, args: Record<string, unknown>, text = ''): Step {
  return () => ({ role: 'assistant', content: text, toolCalls: [{ id: toolCallId(), name, args }] });
}

export function calls(list: [string, Record<string, unknown>][]): Step {
  return () => ({
    role: 'assistant',
    content: '',
    toolCalls: list.map(([name, args]): ToolCall => ({ id: toolCallId(), name, args })),
  });
}

export async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

export function lastToolResult(events: AgentEvent[]): string {
  const end = [...events].reverse().find((e) => e.type === 'tool_end');
  return end && end.type === 'tool_end' ? end.result.content : '';
}
