import type { AssistantMessage, Message, ToolSchema, Usage } from '../types';

export interface ChatRequest {
  model: string;
  system: string;
  messages: Message[];
  tools: ToolSchema[];
  signal?: AbortSignal;
  temperature?: number;
  /** How hard a reasoning model should think. Sent only to providers that take it. */
  effort?: 'low' | 'medium' | 'high';
  /** Router only: this step fixes a repeated error, so wait for a strong model rather than use a fallback. */
  strong?: boolean;
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
