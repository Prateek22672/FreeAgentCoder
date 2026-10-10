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
import { cleanModelText, estimateTokens, truncateMiddle } from '../util/text';
import { displayPath, type Workspace } from '../workspace/types';
import {
  compactionMessage,
  dropEchoes,
  fallbackSummary,
  IMAGES_REMOVED_NOTE,
  microCompact,
  splitTail,
  startFresh,
  SUMMARY_INSTRUCTIONS,
  SUMMARY_SYSTEM,
  transcript,
} from './context';
import { PermissionPolicy, type ApprovalDecision, type ApprovalRequest } from './permissions';
import { CheckpointStore, FileReadTracker, type UndoResult } from './state';
import { extractTextToolCalls } from './textcalls';
import { requestView } from './view';

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
  /** Tokens one user turn may use before it pauses for the user to say continue. 0 or unset: no limit. */
  maxTurnTokens?: number;
  /** Resume a saved conversation. */
  messages?: Message[];
  todos?: Todo[];
  /**
   * Asked when the model is about to end its turn. Return a message to send it
   * back to work (for example, required checks haven't passed), or nothing to
   * let it finish. Asked at most twice per turn.
   */
  reviewCompletion?: (message: AssistantMessage) => string | undefined | Promise<string | undefined>;
  /**
   * Asked after a tool changes files, with their absolute paths. What it returns
   * is added to the tool's result: an editor uses it to report the errors the
   * change introduced, so the model fixes them now rather than at the end.
   */
  afterEdit?: (paths: string[], signal: AbortSignal) => Promise<string | undefined>;
}

export interface RunOptions {
  signal?: AbortSignal;
  /**
   * Images attached to this user message (e.g. screenshots). Vision models see
   * them; text-only models get a placeholder naming them.
   */
  images?: ImagePart[];
  /**
   * A new task unrelated to the conversation so far: earlier tool output is
   * blanked first (requests and replies stay), so it is not resent each step.
   */
  fresh?: boolean;
  /** Files whose current contents this message includes (ones the user mentioned): they count as read, so they can be edited without reading them again. */
  knownFiles?: string[];
  /** Only these tools are offered this turn (a quick task needs few). Default: all. */
  tools?: string[];
  /** How hard reasoning models think this turn. */
  effort?: 'low' | 'medium' | 'high';
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
  | { type: 'done'; reason: 'completed' | 'max_steps' | 'budget' | 'aborted' | 'error'; steps: number };

const NUDGE_ACT =
  "You described your next step but didn't call a tool. Do it now by calling the right tool. If the task is actually finished, reply with a brief summary of what you did instead.";
const NUDGE_EMPTY =
  'Your last reply was empty. Continue the task using the tools, or if it is complete, give a brief summary of what you did.';
const NUDGE_CUT_OFF =
  'Your reply was cut off by the output limit. Be concise: one step at a time and short explanations. Write a large file in parts: the first part with write_file, then the rest with edit_file.';
const NUDGE_REPEAT =
  "You've made the same tool call three times in a row and got the same result. Repeating it won't help: try a different approach, or tell the user what's blocking you.";

const MAX_RESULT_CHARS = 30_000;
/** Nudges in a row without progress, before the reply is accepted as it is. */
const MAX_NUDGES = 3;
/** The same calls this many times in a row: warned at the first number, stopped at the second. */
const REPEAT_WARN = 3;
const REPEAT_STOP = 5;
/** The same error, however many steps apart: diagnosis on a strong model at the first number, a stop at the second. */
const SAME_ERROR_DIAGNOSE = 2;
const SAME_ERROR_STOP = 5;
/** Steps sent to a strong model after an error repeats. */
const STRONG_STEPS = 2;
/** Past the task token limit, a task that changed files or ran something successfully this recently runs on, up to this multiple. */
const PROGRESS_WINDOW = 3;
const BUDGET_STRETCH = 2;
const PROGRESS_TOOLS = new Set(['write_file', 'edit_file', 'run_command']);
/** Steps in a row where every call failed: guidance at the first, a stop at the second. */
const FAILED_STEPS_GUIDE = 3;
const FAILED_STEPS_STOP = 6;
/** How often an open plan is shown again, in steps. */
const PLAN_REMINDER_EVERY = 8;
/**
 * Old tool output and file bodies are blanked once the conversation passes
 * this size, well before it nears a model's limit: every step resends the
 * whole conversation, so bulk nobody reads again is paid for on every step.
 */
const TRIM_OLD_BULK_AT = 24_000;
/** Growth, in tokens, before old output is masked again. */
const MASK_AGAIN_AFTER = 12_000;
/** Tool results kept whole when masking. */
const KEEP_RECENT_TOOLS = 4;
/** History size above which a new, unrelated task starts with earlier output blanked. */
const FRESH_START_AT = 8_000;
/** Summaries in one turn that still left the conversation at its limit, before the turn is stopped. */
const MAX_FUTILE_SUMMARIES = 2;

/**
 * Thrown when the models that can answer are too small for the task: the
 * conversation is at its limit again straight after being summarized, so
 * every further step would summarize, forget, and re-read the same files.
 */
export function tooSmallMessage(limit: number): string {
  return `The models available right now are too small for this task: they take about ${Math.round(limit / 100) / 10}K tokens per request, and the work does not fit in that even after summarizing it. Stopped rather than going round in circles.`;
}

/** Did the reply end by announcing an action instead of doing it? ("Let me create the file:") */
export function announcesAction(text: string): boolean {
  const last = text.trim().split('\n').filter((l) => l.trim()).pop()?.trim() ?? '';
  if (!last || last.endsWith('?') || /let me know/i.test(last)) return false;
  if (/:\s*$/.test(last)) return true;
  return /\b(let me|i[’']ll|i will|i am going to|i[’']m going to|now i[’']ll|next,? i[’']ll)\b[^.?!]*[.:]?\s*$/i.test(last);
}

/**
 * What an error is, without what changes between attempts (line numbers,
 * values, paths), so the same mistake is recognised when it comes back after
 * other steps. For command output it is the exception line, last in a traceback.
 */
export function errorSignature(tool: string, content: string): string {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  const named = [...lines].reverse().find((l) => /^[\w.]*(Error|Exception)\b|\berror(\[\w+\])?:/i.test(l));
  const line = named ?? lines.find((l) => !/^exit\b/i.test(l)) ?? '';
  const normal = line
    .replace(/(["'`]).*?\1/g, '…')
    .replace(/[A-Za-z]:[\\/]\S*|(?:\/[\w.-]+){2,}/g, '<path>')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .slice(0, 160);
  return `${tool}: ${normal}`;
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
  /** Tokens one user turn may use before it pauses. Settable between turns. */
  maxTurnTokens: number;

  private readonly toolMap: Map<string, Tool>;
  private readonly schemas: ToolSchema[];
  private readonly files = new FileReadTracker();
  private readonly checkpoints = new CheckpointStore();
  private approve?: AgentOptions['approve'];
  private running = false;
  /** Reported input tokens over estimated ones, so the estimate tracks the real tokenizer. */
  private calibration = 1;
  /** Context size right after the last masking, so masking happens in batches, not on every step. */
  private maskedAt = 0;
  /** The tools and reasoning effort of the turn being run. */
  private turnSchemas: ToolSchema[];
  private turnEffort?: RunOptions['effort'];

  constructor(private readonly opts: AgentOptions) {
    this.workspace = opts.workspace;
    this.router = opts.router;
    this.permissions = opts.permissions ?? new PermissionPolicy('ask');
    this.systemPrompt = opts.systemPrompt;
    this.messages = opts.messages ? [...opts.messages] : [];
    this.todos = opts.todos ? [...opts.todos] : [];
    this.approve = opts.approve;
    this.maxTurnTokens = opts.maxTurnTokens ?? 0;
    this.toolMap = new Map(opts.tools.map((t) => [t.name, t]));
    this.schemas = opts.tools.map(toSchema);
    this.turnSchemas = this.schemas;
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
    return Math.ceil(this.rawTokens() * this.calibration);
  }

  /** The estimate before calibration: characters over 3.5, of what is actually sent. */
  private rawTokens(): number {
    return estimateRequestTokens(this.systemPrompt, requestView(this.messages), this.turnSchemas);
  }

  contextLimit(): number {
    const configured = this.opts.maxContextTokens ?? 60_000;
    return Math.max(4_000, Math.min(configured, Math.floor(this.router.largestBudget() * 0.85)));
  }

  /** Run one user turn. Consume the events to drive a UI. */
  async *run(input: string, options: RunOptions = {}): AsyncGenerator<AgentEvent> {
    if (this.running) throw new Error('The agent is already working on something.');
    this.running = true;
    const only = options.tools ? new Set(options.tools) : undefined;
    this.turnSchemas = only ? this.schemas.filter((t) => only.has(t.name)) : this.schemas;
    this.turnEffort = options.effort;
    try {
      if (options.fresh && this.messages.length) {
        const before = this.contextTokens();
        // Small histories cost little and may hold what the next request refers to.
        if (before > FRESH_START_AT) {
          const saved = startFresh(this.messages);
          if (saved > 0) {
            this.files.clear();
            this.maskedAt = this.contextTokens();
            yield { type: 'compacted', kind: 'micro', before, after: this.maskedAt };
          }
        }
      }
      if (options.knownFiles?.length) await this.trustFiles(options.knownFiles);
      yield* this.loop(input, options.signal ?? new AbortController().signal, options.images);
    } finally {
      this.running = false;
      this.turnSchemas = this.schemas;
      this.turnEffort = undefined;
    }
  }

  private async *loop(input: string, signal: AbortSignal, images?: ImagePart[]): AsyncGenerator<AgentEvent> {
    this.checkpoints.beginTurn();
    const request: UserMessage = { role: 'user', content: input };
    if (images?.length) request.images = images.map(normalizeImage);
    this.messages.push(request);
    const maxSteps = this.opts.maxSteps ?? 80;
    const usedAtStart = this.usage.inputTokens + this.usage.outputTokens;
    let nudges = 0;
    let reviews = 0;
    let lastKey = '';
    let repeats = 0;
    let failedSteps = 0;
    let planChecked = false;
    let forcedCompaction = false;
    let futile = 0;
    const errorsSeen = new Map<string, number>();
    let strongSteps = 0;
    let overBudget = false;
    /** The last step that changed a file or ran a command successfully. */
    let lastProgress = 0;

    for (let step = 1; ; step++) {
      if (step > maxSteps) {
        yield { type: 'done', reason: 'max_steps', steps: maxSteps };
        return;
      }
      if (signal.aborted) {
        yield { type: 'done', reason: 'aborted', steps: step - 1 };
        return;
      }
      const used = this.usage.inputTokens + this.usage.outputTokens - usedAtStart;
      if (this.maxTurnTokens > 0 && used >= this.maxTurnTokens * (overBudget ? BUDGET_STRETCH : 1)) {
        // A task still landing changes is let run on once, up to a hard ceiling; one going round in circles stops here.
        const looping = [...errorsSeen.values()].some((n) => n >= SAME_ERROR_DIAGNOSE);
        if (!overBudget && lastProgress > 0 && step - lastProgress <= PROGRESS_WINDOW && !looping) {
          overBudget = true;
          yield {
            type: 'notice',
            message: `This task has used ${Math.round(used / 1000)}K tokens and is still making progress, so it carries on (up to ${Math.round((this.maxTurnTokens * BUDGET_STRETCH) / 1000)}K).`,
          };
        } else {
          yield { type: 'done', reason: 'budget', steps: step - 1 };
          return;
        }
      }
      if (yield* this.manageContext(signal)) {
        // Summarized, and still at the limit: nothing more can be dropped.
        if (++futile >= MAX_FUTILE_SUMMARIES) {
          yield { type: 'error', message: tooSmallMessage(this.contextLimit()) };
          yield { type: 'done', reason: 'error', steps: step - 1 };
          return;
        }
      }
      const requestSize = this.contextTokens();
      const rawSize = this.rawTokens();

      let message: AssistantMessage;
      let partial = '';
      let reported = false;
      try {
        const strong = strongSteps > 0;
        if (strong) strongSteps--;
        const stream = this.router.stream({
          system: this.systemPrompt,
          messages: requestView(this.messages),
          tools: this.turnSchemas,
          signal,
          effort: strong ? 'high' : this.turnEffort,
          strong,
        });
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
              reported = true;
              if (ev.usage.inputTokens > 0 && rawSize > 500) {
                const ratio = Math.min(1.6, Math.max(0.8, ev.usage.inputTokens / rawSize));
                this.calibration = this.calibration * 0.5 + ratio * 0.5;
              }
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
      if (!reported) {
        // Some providers send no usage with a streamed reply; count an estimate so totals and budgets still hold.
        const usage = {
          inputTokens: requestSize,
          outputTokens: estimateTokens(message.content) + (message.toolCalls ? estimateTokens(JSON.stringify(message.toolCalls)) : 0),
        };
        this.usage = { inputTokens: this.usage.inputTokens + usage.inputTokens, outputTokens: this.usage.outputTokens + usage.outputTokens };
        yield { type: 'usage', usage, total: this.usage };
      }
      this.messages.push(message);
      yield { type: 'assistant', message };

      if (!message.toolCalls?.length) {
        if (nudges < MAX_NUDGES) {
          const nudge =
            message.stop === 'max_tokens' ? NUDGE_CUT_OFF : !message.content ? NUDGE_EMPTY : announcesAction(message.content) ? NUDGE_ACT : null;
          if (nudge) {
            nudges++;
            this.messages.push({ role: 'user', content: nudge, synthetic: true });
            continue;
          }
        }
        const open = this.todos.filter((t) => t.status !== 'completed');
        if (!planChecked && open.length && message.stop !== 'max_tokens' && !message.content.trim().endsWith('?')) {
          planChecked = true;
          this.messages.push({
            role: 'user',
            synthetic: true,
            content: `Your plan still has ${open.length} open item${open.length === 1 ? '' : 's'}: ${open.map((t) => `"${t.content}"`).join(', ')}. Finish them, or update the plan with todo_write (mark them completed, or remove them) and say why.`,
          });
          continue;
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
      nudges = 0;
      let failed = 0;
      let lastError = '';
      let repeated: { signature: string; count: number } | undefined;
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
        if (!result.isError && PROGRESS_TOOLS.has(call.name)) lastProgress = step;
        if (result.isError) {
          failed++;
          lastError = `${call.name}: ${result.content.split('\n')[0]!.slice(0, 200)}`;
          const signature = errorSignature(call.name, result.content);
          const count = (errorsSeen.get(signature) ?? 0) + 1;
          errorsSeen.set(signature, count);
          if (!repeated || count > repeated.count) repeated = { signature, count };
        }
        this.messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: truncateMiddle(result.content, MAX_RESULT_CHARS),
          ...(result.isError ? { isError: true } : {}),
        });
      }

      if (repeated && repeated.count >= SAME_ERROR_STOP) {
        yield {
          type: 'error',
          message: `Stopped: the same error came back ${repeated.count} times (${repeated.signature}). More attempts would not help. Nothing is lost; say what to try, or press Continue for one more go.`,
        };
        yield { type: 'done', reason: 'error', steps: step };
        return;
      }
      if (repeated && repeated.count === SAME_ERROR_DIAGNOSE) {
        // The same mistake twice means the fix is aimed at a symptom: one step of diagnosis on the best model available costs less than more guesses.
        strongSteps = STRONG_STEPS;
        this.messages.push({
          role: 'user',
          synthetic: true,
          content: `The same error has now happened twice: ${repeated.signature}\nStop patching it line by line. Before changing anything: (1) read the code that produces it, (2) state its root cause in one sentence, (3) fix every place with that cause in one change, not just the line in the traceback, then (4) run it again. If an edit keeps failing to match, rewrite the file with write_file.`,
        });
        yield { type: 'notice', message: 'The same error came back, so the next steps go to the strongest model available to find its cause.' };
      }

      // Polling a background process is meant to repeat.
      const key = calls.every((c) => c.name === 'process') ? '' : JSON.stringify(calls.map((c) => [c.name, sortedArgs(c.args)]));
      repeats = key && key === lastKey ? repeats + 1 : 0;
      lastKey = key;
      if (repeats + 1 >= REPEAT_STOP) {
        yield { type: 'error', message: `Stopped: the same ${calls[0]!.name} call was made ${REPEAT_STOP} times in a row with the same result. Nothing is lost; send a message to carry on differently.` };
        yield { type: 'done', reason: 'error', steps: step };
        return;
      }
      if (repeats + 1 === REPEAT_WARN) this.messages.push({ role: 'user', content: NUDGE_REPEAT, synthetic: true });

      failedSteps = failed === calls.length ? failedSteps + 1 : 0;
      if (failedSteps >= FAILED_STEPS_STOP) {
        yield { type: 'error', message: `Stopped after ${FAILED_STEPS_STOP} steps in a row where every tool call failed (last: ${lastError}). Nothing is lost; send a message to continue.` };
        yield { type: 'done', reason: 'error', steps: step };
        return;
      }
      if (failedSteps === FAILED_STEPS_GUIDE) {
        this.messages.push({
          role: 'user',
          synthetic: true,
          content: `The last ${FAILED_STEPS_GUIDE} steps all failed (latest: ${lastError}). Change strategy instead of retrying: read the file again before editing it, use write_file to rewrite a file whose edits keep failing, check the path with glob, or ask the user what is blocking you.`,
        });
      }
      const open = this.todos.filter((t) => t.status !== 'completed');
      if (open.length && step % PLAN_REMINDER_EVERY === 0) {
        const doing = this.todos.find((t) => t.status === 'in_progress');
        this.messages.push({
          role: 'user',
          synthetic: true,
          content: `[Plan: ${this.todos.length - open.length}/${this.todos.length} done${doing ? `; in progress: "${doing.content}"` : ''}]`,
        });
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

    if (!tool || !this.turnSchemas.some((t) => t.name === call.name)) {
      yield { type: 'tool_start', call, label: call.name };
      const available = this.turnSchemas.map((t) => t.name).join(', ');
      return yield* finish(
        call.name,
        toolError(tool ? `${call.name} is not available for this quick task. Use one of: ${available}, or say what you need it for.` : `Unknown tool "${call.name}". Available tools: ${available}.`),
      );
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

    let final = failure !== undefined ? toolError(`${call.name} failed: ${errorText(failure)}`) : result!;
    if (kind === 'write' && !final.isError && paths.length && this.opts.afterEdit) {
      const note = await this.opts.afterEdit(paths, signal).catch(() => undefined);
      if (note) final = { ...final, content: `${final.content}\n\n${note}` };
    }
    yield* finish(label, final);
    if (final.display?.type === 'todos') yield { type: 'todos', todos: this.todos };
    return final;
  }

  /** Trims and, if needed, summarizes. Returns true when a summary still left the conversation at its limit. */
  private async *manageContext(signal: AbortSignal): AsyncGenerator<AgentEvent, boolean> {
    const limit = this.contextLimit();
    let tokens = this.contextTokens();
    // In batches: once masked, the conversation must grow a good deal before masking again. Masking on
    // every step would change old messages each time and defeat the providers' prompt caches.
    const grown = !this.maskedAt || tokens >= this.maskedAt + Math.max(MASK_AGAIN_AFTER, limit * 0.25);
    if (tokens > Math.min(limit * 0.7, TRIM_OLD_BULK_AT) && (grown || tokens > limit)) {
      const saved = microCompact(this.messages, KEEP_RECENT_TOOLS);
      if (saved > 0) {
        tokens = this.contextTokens();
        this.maskedAt = tokens;
        yield { type: 'compacted', kind: 'micro', before: tokens + saved, after: tokens };
      }
    }
    if (tokens <= limit) return false;
    yield* this.compact(signal, 'auto');
    return this.contextTokens() > limit * 0.9;
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
    this.maskedAt = 0;
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

/** Arguments with their keys in a fixed order, so the same call written twice compares equal. */
function sortedArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(args).sort().map((k) => [k, args[k]]));
}
