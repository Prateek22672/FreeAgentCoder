import { ProviderError } from '../providers/errors';
import { ContextTooLargeError, estimateRequestTokens, type ModelRouter } from '../providers/router';
import { validateArgs } from '../tools/schema';
import {
  isPrepared,
  kindOf,
  toolError,
  toSchema,
  type PreparedCall,
  type Tool,
  type ToolContext,
  type ToolResult,
} from '../tools/types';
import { describeImages, normalizeImage } from '../providers/images';
import type { AssistantMessage, ImagePart, Message, Todo, ToolCall, ToolSchema, Usage, UserMessage } from '../types';
import { cleanModelText, truncateMiddle } from '../util/text';
import { displayPath, type Workspace } from '../workspace/types';
import {
  compactionMessage,
  dropEchoes,
  fallbackSummary,
  IMAGES_REMOVED_NOTE,
  microCompact,
  splitTail,
  SUMMARY_INSTRUCTIONS,
  SUMMARY_SYSTEM,
  transcript,
} from './context';
import { PermissionPolicy, type ApprovalDecision, type ApprovalRequest } from './permissions';
import { CheckpointStore, FileReadTracker, type UndoResult } from './state';
import { extractTextToolCalls } from './textcalls';

export interface AgentOptions {
  router: ModelRouter;
  workspace: Workspace;
  tools: Tool[];
  /** Built once per session; never changed mid-session. */
  systemPrompt: string;
  permissions?: PermissionPolicy;
  /** Asks the user. Without it, anything that needs approval is declined. */
  approve?: (request: ApprovalRequest) => Promise<ApprovalDecision>;
  /** Model calls per user turn before pausing. Default 80. */
  maxSteps?: number;
  /** Compact the conversation beyond this many tokens. Default 60k. */
  maxContextTokens?: number;
  /** Resume a saved conversation. */
  messages?: Message[];
  todos?: Todo[];
  /**
   * Asked when the model is about to end its turn. Return a message to send it
   * back to work (for example, required checks haven't passed), or nothing to
   * let it finish. Asked at most twice per turn.
   */
  reviewCompletion?: (message: AssistantMessage) => string | undefined | Promise<string | undefined>;
}

export interface RunOptions {
  signal?: AbortSignal;
  /**
   * Images attached to this user message (e.g. screenshots). Vision models see
   * them; text-only models get a placeholder naming them.
   */
  images?: ImagePart[];
}

export type AgentEvent =
  | { type: 'model'; ref: string; step: number }
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool_call_streaming'; name: string }
  /** Output streamed from a failed attempt should be discarded (a retry follows). */
  | { type: 'reset' }
  /** The finished assistant message for this step (text cleaned up). */
  | { type: 'assistant'; message: AssistantMessage }
  | { type: 'tool_start'; call: ToolCall; label: string }
  /** Emitted right before `approve()` is called, so UIs can pause spinners. */
  | { type: 'approval'; request: ApprovalRequest }
  | { type: 'tool_output'; callId: string; chunk: string }
  | { type: 'tool_end'; call: ToolCall; label: string; result: ToolResult; denied?: boolean }
  | { type: 'todos'; todos: Todo[] }
  | { type: 'notice'; message: string }
  | { type: 'compacted'; kind: 'micro' | 'summary'; before: number; after: number }
  | { type: 'usage'; usage: Usage; total: Usage }
  | { type: 'error'; message: string }
  | { type: 'done'; reason: 'completed' | 'max_steps' | 'aborted' | 'error'; steps: number };

const NUDGE_ACT =
  "You described your next step but didn't call a tool. Do it now by calling the right tool. If the task is actually finished, reply with a brief summary of what you did instead.";
const NUDGE_EMPTY =
  'Your last reply was empty. Continue the task using the tools, or if it is complete, give a brief summary of what you did.';
const NUDGE_CUT_OFF = 'Your previous reply was cut off by the output limit. Continue exactly where you stopped.';
const NUDGE_REPEAT =
  "You've made the same tool call three times in a row and got the same result. Repeating it won't help: try a different approach, or tell the user what's blocking you.";

const MAX_RESULT_CHARS = 30_000;

/** Did the reply end by announcing an action instead of doing it? ("Let me create the file:") */
export function announcesAction(text: string): boolean {
  const last = text.trim().split('\n').filter((l) => l.trim()).pop()?.trim() ?? '';
  if (!last || last.endsWith('?') || /let me know/i.test(last)) return false;
  if (/:\s*$/.test(last)) return true;
  return /\b(let me|i[’']ll|i will|i am going to|i[’']m going to|now i[’']ll|next,? i[’']ll)\b[^.?!]*[.:]?\s*$/i.test(last);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class Agent {
  readonly workspace: Workspace;
  readonly router: ModelRouter;
  readonly permissions: PermissionPolicy;
  readonly systemPrompt: string;
  messages: Message[];
  todos: Todo[];
  usage: Usage = { inputTokens: 0, outputTokens: 0 };

  private readonly toolMap: Map<string, Tool>;
  private readonly schemas: ToolSchema[];
  private readonly files = new FileReadTracker();
  private readonly checkpoints = new CheckpointStore();
  private approve?: AgentOptions['approve'];
  private running = false;

  constructor(private readonly opts: AgentOptions) {
    this.workspace = opts.workspace;
    this.router = opts.router;
    this.permissions = opts.permissions ?? new PermissionPolicy('ask');
    this.systemPrompt = opts.systemPrompt;
    this.messages = opts.messages ? [...opts.messages] : [];
    this.todos = opts.todos ? [...opts.todos] : [];
    this.approve = opts.approve;
    this.toolMap = new Map(opts.tools.map((t) => [t.name, t]));
    this.schemas = opts.tools.map(toSchema);
  }

  get isRunning(): boolean {
    return this.running;
  }

  get canUndo(): boolean {
    return this.checkpoints.canUndo;
  }

  setApprover(approve: AgentOptions['approve']): void {
    this.approve = approve;
  }

  /** Estimated size of the next request, in tokens. */
  contextTokens(): number {
    return estimateRequestTokens(this.systemPrompt, this.messages, this.schemas);
  }

  contextLimit(): number {
    const configured = this.opts.maxContextTokens ?? 60_000;
    return Math.max(4_000, Math.min(configured, Math.floor(this.router.largestBudget() * 0.85)));
  }

  /** Run one user turn. Consume the events to drive a UI. */
  async *run(input: string, options: RunOptions = {}): AsyncGenerator<AgentEvent> {
    if (this.running) throw new Error('The agent is already working on something.');
    this.running = true;
    try {
      yield* this.loop(input, options.signal ?? new AbortController().signal, options.images);
    } finally {
      this.running = false;
    }
  }

  private async *loop(input: string, signal: AbortSignal, images?: ImagePart[]): AsyncGenerator<AgentEvent> {
    this.checkpoints.beginTurn();
    const request: UserMessage = { role: 'user', content: input };
    if (images?.length) request.images = images.map(normalizeImage);
    this.messages.push(request);
    const maxSteps = this.opts.maxSteps ?? 80;
    let nudges = 0;
    let reviews = 0;
    let lastKey = '';
    let repeats = 0;
    let forcedCompaction = false;

    for (let step = 1; ; step++) {
      if (step > maxSteps) {
        yield { type: 'done', reason: 'max_steps', steps: maxSteps };
        return;
      }
      if (signal.aborted) {
        yield { type: 'done', reason: 'aborted', steps: step - 1 };
        return;
      }
      yield* this.manageContext(signal);

      let message: AssistantMessage;
      let partial = '';
      try {
        const stream = this.router.stream({ system: this.systemPrompt, messages: this.messages, tools: this.schemas, signal });
        let next = await stream.next();
        while (!next.done) {
          const ev = next.value;
          switch (ev.type) {
            case 'text':
              partial += ev.delta;
              yield ev;
              break;
            case 'reasoning':
              yield ev;
              break;
            case 'tool_call':
              yield { type: 'tool_call_streaming', name: ev.name };
              break;
            case 'usage':
              this.usage = {
                inputTokens: this.usage.inputTokens + ev.usage.inputTokens,
                outputTokens: this.usage.outputTokens + ev.usage.outputTokens,
              };
              yield { type: 'usage', usage: ev.usage, total: this.usage };
              break;
            case 'model':
              yield { type: 'model', ref: ev.ref, step };
              break;
            case 'notice':
              yield { type: 'notice', message: ev.message };
              break;
            case 'reset':
              partial = '';
              yield { type: 'reset' };
              break;
          }
          next = await stream.next();
        }
        message = next.value;
      } catch (err) {
        if (signal.aborted || (err instanceof ProviderError && err.kind === 'aborted')) {
          if (partial.trim()) this.messages.push({ role: 'assistant', content: `${partial.trim()}\n[interrupted by the user]` });
          yield { type: 'done', reason: 'aborted', steps: step };
          return;
        }
        if (err instanceof ContextTooLargeError && !forcedCompaction) {
          forcedCompaction = true;
          yield* this.compact(signal, 'forced');
          step--;
          continue;
        }
        yield { type: 'error', message: errorText(err) };
        yield { type: 'done', reason: 'error', steps: step };
        return;
      }

      if (!message.toolCalls?.length) {
        const recovered = extractTextToolCalls(message.content, new Set(this.toolMap.keys()));
        if (recovered) {
          message.content = recovered.text;
          message.toolCalls = recovered.calls;
        }
      }
      message.content = cleanModelText(message.content);
      this.messages.push(message);
      yield { type: 'assistant', message };

      if (!message.toolCalls?.length) {
        if (nudges < 2) {
          const nudge =
            message.stop === 'max_tokens' ? NUDGE_CUT_OFF : !message.content ? NUDGE_EMPTY : announcesAction(message.content) ? NUDGE_ACT : null;
          if (nudge) {
            nudges++;
            this.messages.push({ role: 'user', content: nudge, synthetic: true });
            continue;
          }
        }
        if (reviews < 2 && this.opts.reviewCompletion && message.stop !== 'max_tokens') {
          const feedback = await this.opts.reviewCompletion(message);
          if (feedback) {
            reviews++;
            this.messages.push({ role: 'user', content: feedback, synthetic: true });
            yield { type: 'notice', message: 'The task is not finished yet: required checks are still missing. Continuing.' };
            continue;
          }
        }
        yield { type: 'done', reason: 'completed', steps: step };
        return;
      }

      const calls = message.toolCalls;
      for (let i = 0; i < calls.length; i++) {
        if (signal.aborted) {
          for (const skipped of calls.slice(i)) {
            this.messages.push({ role: 'tool', toolCallId: skipped.id, name: skipped.name, content: 'Not run: the user interrupted.', isError: true });
          }
          yield { type: 'done', reason: 'aborted', steps: step };
          return;
        }
        const call = calls[i]!;
        const result = yield* this.execute(call, signal, message.stop === 'max_tokens');
        this.messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: truncateMiddle(result.content, MAX_RESULT_CHARS),
          ...(result.isError ? { isError: true } : {}),
        });
      }

      const key = JSON.stringify(calls.map((c) => [c.name, c.args]));
      repeats = key === lastKey ? repeats + 1 : 0;
      lastKey = key;
      if (repeats >= 2) {
        this.messages.push({ role: 'user', content: NUDGE_REPEAT, synthetic: true });
        repeats = 0;
      }
    }
  }

  private context(signal: AbortSignal, onOutput?: (chunk: string) => void): ToolContext {
    return {
      workspace: this.workspace,
      signal,
      files: this.files,
      checkpoints: this.checkpoints,
      todos: {
        get: () => this.todos,
        set: (todos) => {
          this.todos = todos;
        },
      },
      onOutput,
    };
  }

  private async *execute(call: ToolCall, signal: AbortSignal, cutOff: boolean): AsyncGenerator<AgentEvent, ToolResult> {
    const tool = this.toolMap.get(call.name);
    const finish = function* (label: string, result: ToolResult, denied?: boolean): Generator<AgentEvent, ToolResult> {
      yield { type: 'tool_end', call, label, result, ...(denied ? { denied } : {}) };
      return result;
    };

    if (!tool) {
      yield { type: 'tool_start', call, label: call.name };
      return yield* finish(call.name, toolError(`Unknown tool "${call.name}". Available tools: ${[...this.toolMap.keys()].join(', ')}.`));
    }
    if (call.argsError) {
      yield { type: 'tool_start', call, label: call.name };
      return yield* finish(
        call.name,
        toolError(
          cutOff
            ? `Your reply hit the output-token limit while writing the arguments for ${call.name}, so they were cut off. Split the work up: create large files in smaller parts (write the first part, then add the rest with edit_file).`
            : `The arguments for ${call.name} were not valid JSON (${call.argsError}). Call it again with a valid JSON object.`,
        ),
      );
    }

    const normalized = tool.normalize ? tool.normalize(call.args) : call.args;
    const { value: args, errors } = validateArgs(tool.parameters, normalized);
    if (errors.length) {
      yield { type: 'tool_start', call, label: call.name };
      return yield* finish(call.name, toolError(`Invalid arguments for ${call.name}: ${errors.join('; ')}.`));
    }

    let label = call.name;
    try {
      label = tool.label(args, this.workspace);
    } catch {
      // keep the tool name
    }
    yield { type: 'tool_start', call, label };

    const output: string[] = [];
    let wake: (() => void) | null = null;
    const ctx = this.context(signal, (chunk) => {
      output.push(chunk);
      wake?.();
    });

    let prepared: PreparedCall | ToolResult;
    try {
      prepared = await tool.prepare(args, ctx);
    } catch (err) {
      return yield* finish(label, toolError(`${call.name} failed: ${errorText(err)}`));
    }
    if (!isPrepared(prepared)) return yield* finish(label, prepared);

    const kind = kindOf(tool, args);
    const paths = tool.paths?.(args, this.workspace) ?? [];
    const outsideProject = paths.some((p) => !this.workspace.isInside(p));
    const command = tool.command?.(args);
    const url = tool.url?.(args);
    const verdict = this.permissions.evaluate({ kind, command, url, outsideProject });

    if (verdict.action === 'deny') {
      return yield* finish(
        label,
        toolError(`Blocked by the safety policy: this command ${verdict.reason}. Don't retry it; find another way or ask the user to run it themselves.`),
        true,
      );
    }
    if (verdict.action === 'ask') {
      const request: ApprovalRequest = {
        tool: call.name,
        kind,
        label,
        preview: prepared.preview,
        command,
        url,
        paths: paths.map((p) => displayPath(this.workspace, p)),
        outsideProject,
        reason: verdict.reason,
        canRemember: verdict.canRemember,
      };
      yield { type: 'approval', request };
      const decision: ApprovalDecision = this.approve
        ? await this.approve(request)
        : { allow: false, feedback: 'Actions that need approval are disabled in this mode.' };
      if (!decision.allow) {
        return yield* finish(
          label,
          {
            content: `The user declined this ${call.name} call.${decision.feedback ? ` Their feedback: ${decision.feedback}` : ''} Don't repeat it as-is; adjust your approach or ask what they want.`,
            isError: true,
            summary: 'declined',
          },
          true,
        );
      }
      if (decision.remember) {
        const rule = this.permissions.remember({ kind, command, url, outsideProject });
        yield { type: 'notice', message: `Allowed ${rule}.` };
      }
    }

    // Run, forwarding live output (command stdout) as it arrives.
    let done = false;
    let result: ToolResult | undefined;
    let failure: unknown;
    const running = prepared
      .run()
      .then(
        (r) => {
          result = r;
        },
        (err) => {
          failure = err;
        },
      )
      .finally(() => {
        done = true;
        wake?.();
      });
    while (!done || output.length) {
      if (output.length) {
        yield { type: 'tool_output', callId: call.id, chunk: output.splice(0).join('') };
        continue;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
        if (done || output.length) resolve();
      });
      wake = null;
    }
    await running;

    const final = failure !== undefined ? toolError(`${call.name} failed: ${errorText(failure)}`) : result!;
    yield* finish(label, final);
    if (final.display?.type === 'todos') yield { type: 'todos', todos: this.todos };
    return final;
  }

  private async *manageContext(signal: AbortSignal): AsyncGenerator<AgentEvent> {
    const limit = this.contextLimit();
    let tokens = this.contextTokens();
    if (tokens > limit * 0.7) {
      const saved = microCompact(this.messages);
      if (saved > 0) {
        dropEchoes(this.messages);
        yield { type: 'compacted', kind: 'micro', before: tokens, after: tokens - saved };
        tokens -= saved;
      }
    }
    if (tokens > limit) yield* this.compact(signal, 'auto');
  }

  /**
   * Summarize the conversation so far. `auto` runs when the context outgrows
   * its limit, `forced` when even that isn't enough, `manual` for /compact.
   */
  async *compact(signal?: AbortSignal, mode: 'auto' | 'forced' | 'manual' = 'manual'): AsyncGenerator<AgentEvent> {
    const tailBudget = Math.floor(this.contextLimit() * (mode === 'forced' ? 0.1 : 0.25));
    const { head, tail } = splitTail(this.messages, tailBudget, mode === 'auto' ? 6 : 2);
    if (!head.length) return;
    const before = this.contextTokens();
    yield { type: 'notice', message: 'Summarizing the conversation to free up context…' };

    let summary: string;
    try {
      summary = await this.summarize(head, signal);
    } catch (err) {
      if (signal?.aborted) return;
      yield { type: 'notice', message: `Couldn't get a model summary (${errorText(err)}); using a basic one.` };
      summary = fallbackSummary(head);
    }
    const latest = [...head].reverse().find((m): m is UserMessage => m.role === 'user' && !m.synthetic);
    const tailHasRequest = tail.some((m) => m.role === 'user' && !m.synthetic);
    // Images in the summarized messages are dropped; only their names survive, as text.
    const latestText =
      latest?.images?.length ? `${latest.content}\n[${describeImages(latest.images)} ${IMAGES_REMOVED_NOTE}]` : latest?.content;
    this.messages = [
      { role: 'user', content: compactionMessage(summary, tailHasRequest ? undefined : latestText), synthetic: true },
      ...tail,
    ];
    dropEchoes(this.messages);
    this.files.clear();
    yield { type: 'compacted', kind: 'summary', before, after: this.contextTokens() };
  }

  private async summarize(messages: Message[], signal?: AbortSignal): Promise<string> {
    const maxChars = Math.max(8_000, Math.min(120_000, Math.floor(this.router.largestBudget() * 3.5 * 0.6)));
    const stream = this.router.stream({
      system: SUMMARY_SYSTEM,
      messages: [{ role: 'user', content: `${transcript(messages, maxChars)}\n\n---\n${SUMMARY_INSTRUCTIONS}` }],
      tools: [],
      signal,
    });
    let next = await stream.next();
    while (!next.done) next = await stream.next();
    const text = cleanModelText(next.value.content);
    if (!text) throw new Error('empty summary');
    return text;
  }

  /** Revert the file changes from the agent's most recent turn that changed files. */
  async undo(): Promise<UndoResult | null> {
    const result = await this.checkpoints.undo(this.workspace);
    if (!result) return null;
    const names = [
      ...result.restored.map((p) => `restored ${displayPath(this.workspace, p)}`),
      ...result.deleted.map((p) => `deleted ${displayPath(this.workspace, p)}`),
    ];
    this.messages.push({
      role: 'user',
      synthetic: true,
      content: `[The user reverted your most recent file changes (${names.join(', ')}). Those files are back to their earlier state; re-read them before editing.]`,
    });
    return result;
  }

  /**
   * Treat files as already read, so they can be overwritten without a
   * read_file first. For content the model already knows about, like a
   * starter template described in the system prompt.
   */
  async trustFiles(paths: string[]): Promise<void> {
    for (const p of paths) {
      const abs = this.workspace.resolve(p);
      const st = await this.workspace.stat(abs);
      if (st?.type === 'file') this.files.markRead(abs, st.mtimeMs);
    }
  }

  /** Forget the conversation (files on disk are untouched). */
  clear(): void {
    this.messages = [];
    this.todos = [];
    this.files.clear();
  }
}
