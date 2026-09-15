import type { AssistantMessage, Message, ToolSchema, Usage } from '../types';

export interface ChatRequest {
  model: string;
  system: string;
  messages: Message[];
  tools: ToolSchema[];
  signal?: AbortSignal;
  temperature?: number;
}

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  /** A tool call began streaming (lets UIs show "writing src/App.tsx…" early). */
  | { type: 'tool_call'; name: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'done'; message: AssistantMessage; stopReason: string };

export interface Provider {
  /** Preset id: "groq", "gemini", "anthropic", ... */
  readonly id: string;
  stream(req: ChatRequest): AsyncGenerator<StreamEvent>;
  listModels(signal?: AbortSignal): Promise<string[]>;
}
