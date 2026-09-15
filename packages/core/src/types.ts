/**
 * Provider-neutral conversation types. Every provider adapter converts to and
 * from these, which is what lets one conversation hop between Groq, Gemini,
 * Claude, a local Ollama model, etc. without losing its history.
 */

export interface ToolCall {
  /** Our own id (9 alphanumerics, accepted by every provider). */
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Set when the model's arguments were not valid JSON; `args` is then `{}`. */
  argsError?: string;
}

/**
 * Data a provider needs echoed back verbatim on later requests to the SAME
 * provider+model (Gemini thought signatures, Claude thinking blocks). It is
 * dropped when the conversation moves to a different provider or when history
 * is compacted.
 */
export interface ProviderEcho {
  provider: string;
  model: string;
  data: unknown;
}

export interface UserMessage {
  role: 'user';
  content: string;
  /** Injected by the harness (nudges, summaries) rather than typed by a person. */
  synthetic?: boolean;
}

export interface AssistantMessage {
  role: 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  /** Reasoning text streamed by thinking models, for display only. */
  reasoning?: string;
  /** "provider:model" that produced this message. */
  model?: string;
  /** Why generation stopped: "stop", "tool_use", "max_tokens", … */
  stop?: string;
  echo?: ProviderEcho;
}

export interface ToolMessage {
  role: 'tool';
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
}

export type Message = UserMessage | AssistantMessage | ToolMessage;

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean | JsonSchema;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface Todo {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}
