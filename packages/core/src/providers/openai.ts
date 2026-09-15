import type { AssistantMessage, ToolCall, Usage } from '../types';
import { toolCallId } from '../util/ids';
import { parseToolArgs } from '../util/json';
import { errorFromResponse, ProviderError, toProviderError } from './errors';
import { idleSignal, sseData } from './sse';
import type { ChatRequest, Provider, StreamEvent } from './types';

/**
 * One adapter for every OpenAI-compatible Chat Completions API: Groq, Gemini
 * (compat endpoint), Cerebras, Mistral, OpenRouter, Ollama, OpenAI itself, and
 * any custom base URL. Plain fetch + SSE, so it runs in Node and the browser.
 */

export interface OpenAICompatConfig {
  id: string;
  baseURL: string;
  apiKey?: string;
  headers?: Record<string, string>;
  /** Gemini 3 rejects function calls in history without a thought signature. */
  thoughtSignatures?: boolean;
  maxTokensParam?: 'max_tokens' | 'max_completion_tokens';
  maxOutputTokens?: number;
  extraBody?: Record<string, unknown>;
  idleTimeoutMs?: number;
  /** Sees the HTTP response headers of each chat request (rate-limit dashboards). */
  onHeaders?: (headers: Headers) => void;
}

/** Gemini's documented placeholder for function calls it didn't produce itself. */
const DUMMY_SIGNATURE = 'skip_thought_signature_validator';

interface PartialCall {
  id?: string;
  name: string;
  args: string;
  signature?: string;
}

/**
 * Tool calls arrive as fragments. OpenAI tags each with an `index`; Gemini's
 * compat endpoint sends each call whole with no index; some servers send only
 * ids. This accumulator copes with all three.
 */
export class ToolCallAccumulator {
  readonly calls: PartialCall[] = [];
  private byIndex = new Map<number, number>();

  /** Returns the call's name when this fragment starts a new call. */
  add(fragment: Record<string, unknown>): string | undefined {
    const fn = (fragment.function ?? {}) as { name?: string; arguments?: unknown };
    const index = typeof fragment.index === 'number' ? fragment.index : undefined;
    const id = typeof fragment.id === 'string' && fragment.id ? fragment.id : undefined;
    let slot: number | undefined;

    if (index !== undefined) slot = this.byIndex.get(index);
    else if (id) {
      const found = this.calls.findIndex((c) => c.id === id);
      slot = found === -1 ? undefined : found;
    } else if (!fn.name && this.calls.length) {
      slot = this.calls.length - 1; // continuation fragment
    }

    let started: string | undefined;
    if (slot === undefined) {
      this.calls.push({ id, name: '', args: '' });
      slot = this.calls.length - 1;
      if (index !== undefined) this.byIndex.set(index, slot);
      started = fn.name;
    }
    const call = this.calls[slot]!;
    if (id && !call.id) call.id = id;
    if (fn.name && !call.name) call.name = fn.name;
    if (typeof fn.arguments === 'string') call.args += fn.arguments;
    else if (fn.arguments && typeof fn.arguments === 'object') call.args = JSON.stringify(fn.arguments);

    const extra = fragment.extra_content as { google?: { thought_signature?: string } } | undefined;
    if (extra?.google?.thought_signature) call.signature = extra.google.thought_signature;
    return started;
  }
}

/** gpt-oss sometimes leaks its channel syntax into names: "functions.read_file<|channel|>…". */
export function cleanToolName(name: string): string {
  return name.split('<|')[0]!.replace(/^functions?\./, '').trim();
}

export function finalizeCalls(partials: PartialCall[]): ToolCall[] {
  return partials
    .filter((p) => p.name)
    .map((p) => {
      const parsed = parseToolArgs(p.args);
      return parsed.ok
        ? { id: toolCallId(), name: cleanToolName(p.name), args: parsed.value }
        : { id: toolCallId(), name: cleanToolName(p.name), args: {}, argsError: `${parsed.error}. Raw: ${p.args.slice(0, 300)}` };
    });
}

export class OpenAICompatProvider implements Provider {
  constructor(readonly cfg: OpenAICompatConfig) {}

  get id(): string {
    return this.cfg.id;
  }

  private url(path: string): string {
    return `${this.cfg.baseURL.replace(/\/+$/, '')}${path}`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json', ...this.cfg.headers };
    if (this.cfg.apiKey) h.authorization = `Bearer ${this.cfg.apiKey}`;
    return h;
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const res = await fetch(this.url('/models'), { headers: this.headers(), signal });
    if (!res.ok) throw await errorFromResponse(res, this.id);
    const json = (await res.json()) as { data?: unknown[]; models?: unknown[] };
    const list = (json.data ?? json.models ?? []) as Record<string, unknown>[];
    return list
      .map((m) => String(m.id ?? m.name ?? m.model ?? '').replace(/^models\//, ''))
      .filter(Boolean);
  }

  buildBody(req: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: this.toMessages(req),
      stream: true,
    };
    if (req.tools.length) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (this.cfg.maxOutputTokens) body[this.cfg.maxTokensParam ?? 'max_tokens'] = this.cfg.maxOutputTokens;
    Object.assign(body, this.cfg.extraBody);
    return body;
  }

  private toMessages(req: ChatRequest): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [{ role: 'system', content: req.system }];
    for (const m of req.messages) {
      if (m.role === 'user') {
        out.push({ role: 'user', content: m.content });
      } else if (m.role === 'tool') {
        out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content || '(no output)' });
      } else {
        if (!m.content && !m.toolCalls?.length) continue;
        const msg: Record<string, unknown> = { role: 'assistant', content: m.content || null };
        if (m.toolCalls?.length) {
          const own = m.echo?.provider === this.id && m.echo.model === req.model;
          const signatures = own ? ((m.echo!.data as { signatures?: (string | undefined)[] }).signatures ?? []) : [];
          msg.tool_calls = m.toolCalls.map((c, i) => {
            const call: Record<string, unknown> = {
              id: c.id,
              type: 'function',
              function: { name: c.name, arguments: JSON.stringify(c.args) },
            };
            if (this.cfg.thoughtSignatures) {
              const signature = signatures[i] ?? (i === 0 ? DUMMY_SIGNATURE : undefined);
              if (signature) call.extra_content = { google: { thought_signature: signature } };
            }
            return call;
          });
        }
        out.push(msg);
      }
    }
    return out;
  }

  async *stream(req: ChatRequest): AsyncGenerator<StreamEvent> {
    const idleMs = this.cfg.idleTimeoutMs ?? 120_000;
    const idle = idleSignal(req.signal, idleMs, () =>
      new ProviderError(`${this.id}: no data from the model for ${idleMs / 1000}s`, 'network', { provider: this.id }),
    );
    try {
      let res: Response;
      try {
        res = await fetch(this.url('/chat/completions'), {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(this.buildBody(req)),
          signal: idle.signal,
        });
      } catch (err) {
        throw toProviderError(idle.signal.reason ?? err, this.id, req.signal);
      }
      this.cfg.onHeaders?.(res.headers);
      if (!res.ok) throw await errorFromResponse(res, this.id);

      // A server that ignored stream:true and answered with one JSON body.
      if ((res.headers.get('content-type') ?? '').includes('application/json')) {
        yield* this.fromCompletion((await res.json()) as Record<string, unknown>, req.model);
        return;
      }
      if (!res.body) throw new ProviderError(`${this.id}: empty response body`, 'network', { provider: this.id });

      const calls = new ToolCallAccumulator();
      let text = '';
      let reasoning = '';
      let finish = '';
      let usage: Usage | undefined;

      try {
        for await (const data of sseData(res.body)) {
          idle.touch();
          if (data === '[DONE]') break;
          let chunk: Record<string, unknown>;
          try {
            chunk = JSON.parse(data) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (chunk.error) {
            const e = chunk.error as { message?: string; code?: unknown };
            throw errorFromPayload(this.id, e);
          }
          const u = (chunk.usage ?? (chunk.x_groq as { usage?: unknown } | undefined)?.usage) as
            | { prompt_tokens?: number; completion_tokens?: number }
            | undefined;
          if (u && typeof u.prompt_tokens === 'number') {
            usage = { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens ?? 0 };
          }
          const choice = (chunk.choices as Record<string, unknown>[] | undefined)?.[0];
          if (!choice) continue;
          const delta = (choice.delta ?? choice.message ?? {}) as Record<string, unknown>;
          if (typeof delta.content === 'string' && delta.content) {
            text += delta.content;
            yield { type: 'text', delta: delta.content };
          }
          const r = delta.reasoning_content ?? delta.reasoning;
          if (typeof r === 'string' && r) {
            reasoning += r;
            yield { type: 'reasoning', delta: r };
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const fragment of delta.tool_calls as Record<string, unknown>[]) {
              const started = calls.add(fragment);
              if (started) yield { type: 'tool_call', name: cleanToolName(started) };
            }
          }
          if (typeof choice.finish_reason === 'string') finish = choice.finish_reason;
        }
      } catch (err) {
        throw toProviderError(idle.signal.reason ?? err, this.id, req.signal);
      }

      if (usage) yield { type: 'usage', usage };
      yield { type: 'done', message: this.assemble(text, reasoning, calls.calls, req.model), stopReason: normalizeFinish(finish) };
    } finally {
      idle.dispose();
    }
  }

  private assemble(text: string, reasoning: string, partials: PartialCall[], model: string): AssistantMessage {
    const toolCalls = finalizeCalls(partials);
    const message: AssistantMessage = { role: 'assistant', content: text, model: `${this.id}:${model}` };
    if (reasoning) message.reasoning = reasoning;
    if (toolCalls.length) {
      message.toolCalls = toolCalls;
      const named = partials.filter((p) => p.name);
      if (named.some((p) => p.signature)) {
        message.echo = { provider: this.id, model, data: { signatures: named.map((p) => p.signature) } };
      }
    }
    return message;
  }

  private async *fromCompletion(json: Record<string, unknown>, model: string): AsyncGenerator<StreamEvent> {
    if (json.error) throw errorFromPayload(this.id, json.error as { message?: string; code?: unknown });
    const choice = (json.choices as Record<string, unknown>[] | undefined)?.[0] ?? {};
    const msg = (choice.message ?? {}) as Record<string, unknown>;
    const text = typeof msg.content === 'string' ? msg.content : '';
    const reasoning = String(msg.reasoning_content ?? msg.reasoning ?? '');
    const calls = new ToolCallAccumulator();
    for (const fragment of (msg.tool_calls as Record<string, unknown>[] | undefined) ?? []) calls.add(fragment);
    if (text) yield { type: 'text', delta: text };
    const u = json.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    if (u?.prompt_tokens !== undefined) {
      yield { type: 'usage', usage: { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens ?? 0 } };
    }
    yield {
      type: 'done',
      message: this.assemble(text, reasoning, calls.calls, model),
      stopReason: normalizeFinish(String(choice.finish_reason ?? 'stop')),
    };
  }
}

function errorFromPayload(provider: string, e: { message?: string; code?: unknown }): ProviderError {
  const code = Number(e.code);
  const message = e.message ?? 'stream error';
  const kind = code === 429 ? 'rate_limit' : code >= 500 ? 'server' : code === 413 ? 'too_large' : 'bad_request';
  return new ProviderError(`${provider}: ${message}`, kind, { provider, status: Number.isFinite(code) ? code : undefined });
}

function normalizeFinish(reason: string): string {
  if (reason === 'length') return 'max_tokens';
  if (reason === 'tool_calls' || reason === 'function_call') return 'tool_use';
  return reason || 'stop';
}
