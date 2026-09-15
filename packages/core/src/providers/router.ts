import type { AssistantMessage, Message, ToolSchema } from '../types';
import { estimateTokens } from '../util/text';
import { ProviderError, type ProviderErrorKind } from './errors';
import { imageTokens } from './images';
import { pickModel } from './presets';
import type { ChatRequest, Provider, StreamEvent } from './types';

/**
 * The model router makes a pile of rate-limited free tiers behave like one
 * dependable model.
 *
 * - Failover is per model CALL, never per agent run: a file edited or a
 *   command run in step 3 is never redone because step 4 changed provider.
 * - A failing model hands over to the next one at once and cools down (longer
 *   after repeated failures). Short rate limits and server hiccups are only
 *   waited out in place when no other model can answer.
 * - Requests too big for a provider's free tier are routed around it.
 * - A retired model id is replaced from the provider's live model list.
 * - A refusal is final: we never shop a declined request to another provider.
 */

export interface RouterEntry {
  provider: Provider;
  model: string;
  contextWindow: number;
  maxRequestTokens?: number;
  /** For model re-resolution when the id is retired. */
  prefer?: RegExp[];
  temperature?: number;
  /** Shown in notices when several entries share a model, e.g. one entry per API key. */
  label?: string;
}

export type RouterEvent =
  | StreamEvent
  /** A model attempt is starting; `ref` is "provider:model". */
  | { type: 'model'; ref: string }
  | { type: 'notice'; message: string }
  /** The attempt failed after streaming some output; UIs should discard it. */
  | { type: 'reset' };

export class ContextTooLargeError extends Error {
  constructor(
    readonly estimatedTokens: number,
    readonly largestBudget: number,
  ) {
    super(`The conversation (~${estimatedTokens} tokens) is larger than any configured model accepts (${largestBudget}).`);
    this.name = 'ContextTooLargeError';
  }
}

export class AllProvidersFailedError extends Error {
  constructor(readonly failures: { ref: string; error: ProviderError }[]) {
    super(
      failures.length
        ? `Every model failed:\n${failures.map((f) => `  • ${f.ref}: ${f.error.message}`).join('\n')}`
        : 'No model is configured. Add a free API key (run: agentic setup).',
    );
    this.name = 'AllProvidersFailedError';
  }
}

/** One model call, for dashboards and logs. */
export interface CallRecord {
  ref: string;
  provider: string;
  model: string;
  ok: boolean;
  /** Set when the call failed. */
  errorKind?: ProviderErrorKind;
  error?: string;
  ms: number;
  usage?: { inputTokens: number; outputTokens: number };
  at: number;
}

export interface EntryStatus {
  ref: string;
  provider: string;
  model: string;
  label?: string;
  budget: number;
  /** ms until the cooldown ends (0 = usable now). */
  cooldownMs: number;
  disabled?: string;
}

export interface RouterOptions {
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Longest rate-limit wait handled in place (only when no other model can answer). */
  maxInlineWaitMs?: number;
  /** Called after every model call, successful or not. */
  onCall?: (record: CallRecord) => void;
}

const OUTPUT_RESERVE = 8_192;
/** Cooldown after a transient failure when another model took over; doubles per consecutive failure. */
const TRANSIENT_COOLDOWN_MS: Partial<Record<ProviderErrorKind, number>> = { server: 30_000, network: 15_000, bad_request: 60_000 };
const MAX_TRANSIENT_COOLDOWN_MS = 5 * 60_000;

export function refOf(entry: RouterEntry): string {
  return `${entry.provider.id}:${entry.model}`;
}

/** refOf plus the entry's label, for messages people read. */
export function nameOf(entry: RouterEntry): string {
  return entry.label ? `${refOf(entry)} (${entry.label})` : refOf(entry);
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ProviderError('aborted', 'aborted'));
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      reject(new ProviderError('aborted', 'aborted'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function estimateRequestTokens(system: string, messages: Message[], tools: ToolSchema[]): number {
  let tokens = estimateTokens(system) + estimateTokens(JSON.stringify(tools));
  for (const m of messages) {
    tokens += estimateTokens(m.content) + 4 + imageTokens(m);
    if (m.role === 'assistant' && m.toolCalls) tokens += estimateTokens(JSON.stringify(m.toolCalls));
  }
  return tokens;
}

export class ModelRouter {
  private entries: RouterEntry[];
  private cooldownUntil = new Map<RouterEntry, number>();
  private disabled = new Map<RouterEntry, string>();
  /** Smallest request size a provider rejected as too large. */
  private rejectedAt = new Map<RouterEntry, number>();
  private resolved = new Set<RouterEntry>();
  /** Consecutive transient failures, for escalating cooldowns. */
  private failStreak = new Map<RouterEntry, number>();
  private now: () => number;
  private sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private maxInlineWaitMs: number;
  private onCall?: (record: CallRecord) => void;

  constructor(entries: RouterEntry[], opts: RouterOptions = {}) {
    this.entries = [...entries];
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
    this.maxInlineWaitMs = opts.maxInlineWaitMs ?? 20_000;
    this.onCall = opts.onCall;
  }

  get chain(): readonly RouterEntry[] {
    return this.entries;
  }

  /** Live state of every model in the chain (for status displays). */
  status(): EntryStatus[] {
    return this.entries.map((e) => ({
      ref: refOf(e),
      provider: e.provider.id,
      model: e.model,
      label: e.label,
      budget: this.budgetOf(e),
      cooldownMs: Math.max(0, (this.cooldownUntil.get(e) ?? 0) - this.now()),
      disabled: this.disabled.get(e),
    }));
  }

  /** Forget cooldowns and disabled flags (e.g. after keys were changed). */
  reset(): void {
    this.cooldownUntil.clear();
    this.disabled.clear();
    this.rejectedAt.clear();
    this.resolved.clear();
    this.failStreak.clear();
  }

  /**
   * Swap the whole chain between runs (keys added, a different tier picked).
   * Entry objects passed in again keep their cooldowns and learned limits, so
   * reuse them rather than rebuilding equivalent ones.
   */
  replaceChain(entries: RouterEntry[]): void {
    this.entries = [...entries];
  }

  get primary(): RouterEntry | undefined {
    return this.entries[0];
  }

  get primaryRef(): string {
    return this.primary ? refOf(this.primary) : '(none)';
  }

  /** Move a model to the front (the /model command). */
  prefer(entry: RouterEntry): void {
    this.entries = [entry, ...this.entries.filter((e) => refOf(e) !== refOf(entry))];
    this.disabled.delete(entry);
    this.cooldownUntil.delete(entry);
    this.failStreak.delete(entry);
  }

  budgetOf(entry: RouterEntry): number {
    const windowBudget = entry.contextWindow - Math.min(OUTPUT_RESERVE, Math.floor(entry.contextWindow * 0.25));
    const rejected = this.rejectedAt.get(entry);
    return Math.min(windowBudget, entry.maxRequestTokens ?? Infinity, rejected !== undefined ? rejected - 1 : Infinity);
  }

  /** The biggest request any usable model accepts. */
  largestBudget(): number {
    const usable = this.entries.filter((e) => !this.disabled.has(e));
    return usable.length ? Math.max(...usable.map((e) => this.budgetOf(e))) : 0;
  }

  async *stream(req: Omit<ChatRequest, 'model'>): AsyncGenerator<RouterEvent, AssistantMessage> {
    const estimate = estimateRequestTokens(req.system, req.messages, req.tools);
    const usable = this.entries.filter((e) => !this.disabled.has(e));
    if (!usable.length) {
      throw new AllProvidersFailedError(
        this.entries.map((e) => ({ ref: nameOf(e), error: new ProviderError(this.disabled.get(e) ?? 'disabled', 'auth') })),
      );
    }
    const fitting = usable.filter((e) => this.budgetOf(e) >= estimate);
    if (!fitting.length) throw new ContextTooLargeError(estimate, this.largestBudget());

    const failures: { ref: string; error: ProviderError }[] = [];
    // Models cooling down go last; if they're all cooling, wait for the soonest.
    const order = [...fitting].sort((a, b) => (this.cooling(a) ? 1 : 0) - (this.cooling(b) ? 1 : 0));

    for (let i = 0; i < order.length; i++) {
      const entry = order[i]!;
      const wait = (this.cooldownUntil.get(entry) ?? 0) - this.now();
      if (wait > 0) {
        if (wait > 90_000) {
          failures.push({ ref: nameOf(entry), error: new ProviderError(`cooling down for ${Math.ceil(wait / 1000)}s`, 'rate_limit') });
          continue;
        }
        yield { type: 'notice', message: `Every model is cooling down; waiting ${Math.ceil(wait / 1000)}s for ${nameOf(entry)}…` };
        await this.sleep(wait, req.signal);
      }

      const hasAlternative = order.slice(i + 1).some((e) => !this.cooling(e));
      const outcome = yield* this.attempt(entry, req, estimate, hasAlternative);
      if (outcome.ok) return outcome.message;
      failures.push({ ref: nameOf(entry), error: outcome.error });
      const next = order[i + 1];
      if (next) yield { type: 'notice', message: `${nameOf(entry)} failed (${describe(outcome.error.kind)}); switching to ${nameOf(next)}.` };
    }
    throw new AllProvidersFailedError(failures);
  }

  private cooling(entry: RouterEntry): boolean {
    return (this.cooldownUntil.get(entry) ?? 0) > this.now();
  }

  private parkAfterFailure(entry: RouterEntry, kind: ProviderErrorKind): void {
    const base = TRANSIENT_COOLDOWN_MS[kind];
    if (!base) return;
    const streak = (this.failStreak.get(entry) ?? 0) + 1;
    this.failStreak.set(entry, streak);
    this.cooldownUntil.set(entry, this.now() + Math.min(MAX_TRANSIENT_COOLDOWN_MS, base * 2 ** (streak - 1)));
  }

  /** A model that keeps hitting rate limits while others can answer is parked longer each time. */
  private rateLimitCooldown(entry: RouterEntry, retryAfter: number | undefined, hasAlternative: boolean): number {
    const base = retryAfter ?? 60_000;
    if (!hasAlternative) return base;
    const streak = (this.failStreak.get(entry) ?? 0) + 1;
    this.failStreak.set(entry, streak);
    return Math.max(base, Math.min(MAX_TRANSIENT_COOLDOWN_MS, 15_000 * 2 ** (streak - 1)));
  }

  private async *attempt(
    entry: RouterEntry,
    req: Omit<ChatRequest, 'model'>,
    estimate: number,
    hasAlternative: boolean,
  ): AsyncGenerator<RouterEvent, { ok: true; message: AssistantMessage } | { ok: false; error: ProviderError }> {
    let lastError: ProviderError | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      yield { type: 'model', ref: refOf(entry) };
      let emitted = false;
      const startedAt = this.now();
      let usage: CallRecord['usage'];
      const record = (ok: boolean, error?: ProviderError) =>
        this.onCall?.({
          ref: refOf(entry),
          provider: entry.provider.id,
          model: entry.model,
          ok,
          errorKind: error?.kind,
          error: error?.message,
          ms: this.now() - startedAt,
          usage,
          at: startedAt,
        });
      try {
        const temperature = lastError?.kind === 'bad_tool_call' ? 0.2 : entry.temperature;
        for await (const event of entry.provider.stream({ ...req, model: entry.model, temperature })) {
          if (event.type === 'done') {
            this.cooldownUntil.delete(entry);
            this.failStreak.delete(entry);
            record(true);
            return { ok: true, message: { ...event.message, stop: event.stopReason } };
          }
          if (event.type === 'usage') usage = event.usage;
          if (event.type === 'text' || event.type === 'reasoning') emitted = true;
          yield event;
        }
        throw new ProviderError(`${entry.provider.id}: stream ended early`, 'network');
      } catch (err) {
        const error = err instanceof ProviderError ? err : new ProviderError(String(err), 'network');
        if (error.kind === 'aborted' || req.signal?.aborted) throw new ProviderError('aborted', 'aborted');
        record(false, error);
        if (emitted) yield { type: 'reset' };
        lastError = error;

        switch (error.kind) {
          case 'refusal':
            throw error;
          case 'rate_limit': {
            const retryAfter = error.retryAfterMs;
            if (!hasAlternative && retryAfter !== undefined && retryAfter <= this.maxInlineWaitMs && attempt < 2) {
              yield { type: 'notice', message: `${nameOf(entry)} rate-limited; retrying in ${Math.max(1, Math.ceil(retryAfter / 1000))}s…` };
              await this.sleep(retryAfter + 250, req.signal);
              continue;
            }
            this.cooldownUntil.set(entry, this.now() + this.rateLimitCooldown(entry, retryAfter, hasAlternative));
            return { ok: false, error };
          }
          case 'too_large':
            this.rejectedAt.set(entry, Math.min(this.rejectedAt.get(entry) ?? Infinity, estimate));
            return { ok: false, error };
          case 'bad_tool_call':
            if (attempt < 1) continue;
            return { ok: false, error };
          case 'server':
          case 'network':
            if (!hasAlternative && attempt < 1) {
              await this.sleep(1_500, req.signal);
              continue;
            }
            if (hasAlternative) this.parkAfterFailure(entry, error.kind);
            return { ok: false, error };
          case 'bad_request':
            if (hasAlternative) this.parkAfterFailure(entry, error.kind);
            return { ok: false, error };
          case 'model_not_found': {
            const replacement = await this.resolveModel(entry, req.signal);
            if (replacement) {
              yield { type: 'notice', message: `${nameOf(entry)} is unavailable; using ${entry.provider.id}:${replacement} instead.` };
              entry.model = replacement;
              continue;
            }
            this.disabled.set(entry, error.message);
            return { ok: false, error };
          }
          case 'auth':
            this.disabled.set(entry, error.message);
            return { ok: false, error };
          default:
            return { ok: false, error };
        }
      }
    }
    return { ok: false, error: lastError ?? new ProviderError('failed', 'network') };
  }

  private async resolveModel(entry: RouterEntry, signal?: AbortSignal): Promise<string | undefined> {
    if (this.resolved.has(entry) || !entry.prefer?.length) return undefined;
    this.resolved.add(entry);
    try {
      const available = await entry.provider.listModels(signal);
      const pick = pickModel(available, entry.prefer);
      return pick && pick !== entry.model ? pick : undefined;
    } catch {
      return undefined;
    }
  }
}

function describe(kind: ProviderErrorKind): string {
  switch (kind) {
    case 'rate_limit':
      return 'rate limit';
    case 'too_large':
      return 'request too large for its free tier';
    case 'auth':
      return 'invalid API key';
    case 'model_not_found':
      return 'model unavailable';
    case 'bad_tool_call':
      return 'malformed tool call';
    case 'server':
      return 'server error';
    case 'network':
      return 'network error';
    case 'bad_request':
      return 'request rejected';
    default:
      return 'error';
  }
}
