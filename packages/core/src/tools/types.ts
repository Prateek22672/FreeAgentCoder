import type { JsonSchema, Todo, ToolSchema } from '../types';
import type { Workspace } from '../workspace/types';

/** Drives permission decisions: reads are free, writes/exec/network may need approval. */
export type ToolKind = 'read' | 'write' | 'exec' | 'network' | 'meta';

/** Structured result for UIs (the model only ever sees `content`). */
export type ToolDisplay =
  | { type: 'diff'; path: string; before: string; after: string; created: boolean }
  | {
      type: 'command';
      command: string;
      output: string;
      exitCode: number | null;
      timedOut?: boolean;
      background?: boolean;
    }
  | { type: 'todos'; todos: Todo[] }
  | { type: 'text'; text: string };

export interface ToolResult {
  /** What the model sees. */
  content: string;
  isError?: boolean;
  /** One short line for UIs, e.g. "42 lines" or "exit 0". */
  summary?: string;
  display?: ToolDisplay;
}

export interface FileTracker {
  markRead(absPath: string, mtimeMs: number): void;
  /** mtime recorded at the last read/write, or undefined if never read. */
  readMtime(absPath: string): number | undefined;
}

export interface Checkpointer {
  /** Remember a file's content before the first change in this turn (null = file did not exist). */
  record(absPath: string, before: string | null): void;
}

export interface ToolContext {
  workspace: Workspace;
  signal: AbortSignal;
  files: FileTracker;
  checkpoints: Checkpointer;
  todos: { get(): Todo[]; set(todos: Todo[]): void };
  /** Live output from long-running tools (command stdout/stderr). */
  onOutput?: (chunk: string) => void;
}

export interface PreparedCall {
  /** Shown when asking the user for approval, e.g. the exact diff. */
  preview?: ToolDisplay;
  run(): Promise<ToolResult>;
}

export interface Tool<A = any> {
  name: string;
  description: string;
  parameters: JsonSchema;
  kind: ToolKind | ((args: A) => ToolKind);
  /** Fix up common argument mistakes before validation (optional). */
  normalize?(args: Record<string, unknown>): Record<string, unknown>;
  /** Short label for UIs: "Read src/app.ts", "$ npm test". */
  label(args: A, ws: Workspace): string;
  /** Absolute paths the call touches, for outside-the-project checks. */
  paths?(args: A, ws: Workspace): string[];
  /** The shell command (exec tools), for permission rules. */
  command?(args: A): string | undefined;
  /** The URL (network tools), for permission rules. */
  url?(args: A): string | undefined;
  /**
   * Validate and plan the call. Returning a ToolResult ends the call right
   * away (usually an error, so the user is never asked to approve a broken
   * edit); returning a PreparedCall runs it once permission is granted.
   */
  prepare(args: A, ctx: ToolContext): Promise<PreparedCall | ToolResult>;
}

export function isPrepared(x: PreparedCall | ToolResult): x is PreparedCall {
  return typeof (x as PreparedCall).run === 'function';
}

export function toolError(content: string): ToolResult {
  return { content, isError: true, summary: firstLine(content) };
}

export function firstLine(text: string, max = 120): string {
  const line = text.split('\n', 1)[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function kindOf(tool: Tool, args: unknown): ToolKind {
  return typeof tool.kind === 'function' ? tool.kind(args) : tool.kind;
}

export function toSchema(tool: Tool): ToolSchema {
  return { name: tool.name, description: tool.description, parameters: tool.parameters };
}
