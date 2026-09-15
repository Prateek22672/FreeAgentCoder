import Anthropic from '@anthropic-ai/sdk';
import type { AssistantMessage, Message, ToolCall, Usage } from '../types';
import { toolCallId } from '../util/ids';
import { classify, ProviderError, retryAfterFrom } from './errors';
import { imagePlaceholder, modelSupportsImages, sendableImages } from './images';
import type { ChatRequest, Provider, StreamEvent } from './types';

/**
 * Native Claude adapter on the official SDK. Claude is the paid "bring your
 * own key" option: it is never picked automatically, only when the user
 * selects it.
 */

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AnthropicConfig {
  apiKey?: string;
  baseURL?: string;
  effort?: Effort;
  maxOutputTokens?: number;
  /** Set in the web builder, where the browser calls the API directly with the user's key. */
  browser?: boolean;
  /** Sees the HTTP response headers of each request (rate-limit dashboards). */
  onHeaders?: (headers: Headers) => void;
  /** Whether the model accepts image input. Default: true for claude-* models. */
  supportsImages?: boolean | ((model: string) => boolean);
}

function tapHeaders(onHeaders: (headers: Headers) => void): typeof fetch {
  return async (...args: Parameters<typeof fetch>) => {
    const res = await fetch(...args);
    onHeaders(res.headers);
    return res;
  };
}

type ContentBlock = Anthropic.Beta.BetaContentBlockParam;
type MessageParam = Anthropic.Beta.BetaMessageParam;

/** Models on the adaptive-thinking + effort API surface. */
function isCurrentGen(model: string): boolean {
  return /claude-(opus|sonnet|fable|mythos)-(5|4-[678])/.test(model);
}

/** Models that support server-side refusal fallbacks (`fallbacks: "default"`). */
function supportsFallbacks(model: string): boolean {
  return /claude-(opus-5|fable-5)/.test(model);
}

export class AnthropicProvider implements Provider {
  readonly id = 'anthropic';
  private client: Anthropic;

  constructor(private cfg: AnthropicConfig) {
    this.client = new Anthropic({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
      maxRetries: 0, // the router owns retries and failover
      dangerouslyAllowBrowser: cfg.browser ?? false,
      fetch: cfg.onHeaders ? tapHeaders(cfg.onHeaders) : undefined,
    });
  }

  async listModels(): Promise<string[]> {
    const ids: string[] = [];
    try {
      for await (const model of this.client.models.list()) ids.push(model.id);
    } catch (err) {
      throw fromSdkError(err);
    }
    return ids;
  }

  supportsImages(model: string): boolean {
    const opt = this.cfg.supportsImages;
    if (typeof opt === 'function') return opt(model);
    return opt ?? modelSupportsImages(this.id, model);
  }

  async *stream(req: ChatRequest): AsyncGenerator<StreamEvent> {
    const params: Anthropic.Beta.MessageCreateParamsStreaming = {
      model: req.model,
      max_tokens: this.cfg.maxOutputTokens ?? 64_000,
      system: req.system,
      messages: toAnthropicMessages(req.messages, { images: this.supportsImages(req.model) }),
      tools: req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: { ...t.parameters, type: 'object' } as Anthropic.Beta.BetaTool.InputSchema,
      })),
      // Automatic prompt caching: the system prompt, tools and history prefix
      // are identical from one agent step to the next.
      cache_control: { type: 'ephemeral' },
      stream: true,
    };
    if (isCurrentGen(req.model)) {
      params.thinking = { type: 'adaptive', display: 'summarized' };
      params.output_config = { effort: this.cfg.effort ?? 'xhigh' };
    }
    if (supportsFallbacks(req.model)) {
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
    }

    let final: Anthropic.Beta.BetaMessage;
    try {
      const stream = this.client.beta.messages.stream(params, { signal: req.signal });
      for await (const event of stream) {
        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          yield { type: 'tool_call', name: event.content_block.name };
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') yield { type: 'text', delta: event.delta.text };
          else if (event.delta.type === 'thinking_delta') yield { type: 'reasoning', delta: event.delta.thinking };
        }
      }
      final = await stream.finalMessage();
    } catch (err) {
      if (req.signal?.aborted) throw new ProviderError('aborted', 'aborted', { provider: this.id });
      throw fromSdkError(err);
    }

    if (final.stop_reason === 'refusal') {
      const category = final.stop_details?.category;
      throw new ProviderError(
        `Claude declined to continue${category ? ` (${category})` : ''}.${final.stop_details?.explanation ? ` ${final.stop_details.explanation}` : ''}`,
        'refusal',
        { provider: this.id },
      );
    }

    const usage: Usage = {
      inputTokens:
        final.usage.input_tokens +
        (final.usage.cache_read_input_tokens ?? 0) +
        (final.usage.cache_creation_input_tokens ?? 0),
      outputTokens: final.usage.output_tokens,
    };
    yield { type: 'usage', usage };
    yield { type: 'done', message: toAssistantMessage(final, req.model), stopReason: final.stop_reason ?? 'end_turn' };
  }
}

/**
 * Keep Claude's own content blocks (thinking blocks carry signatures that must
 * be echoed back unchanged), but re-key tool_use ids to our provider-neutral
 * ids so the same history also works if the conversation moves elsewhere.
 */
function toAssistantMessage(final: Anthropic.Beta.BetaMessage, model: string): AssistantMessage {
  let text = '';
  let reasoning = '';
  const toolCalls: ToolCall[] = [];
  const echoed: ContentBlock[] = [];
  for (const block of final.content) {
    if (block.type === 'text') {
      text += block.text;
      echoed.push(block as ContentBlock);
    } else if (block.type === 'thinking') {
      reasoning += block.thinking;
      echoed.push(block as ContentBlock);
    } else if (block.type === 'tool_use') {
      const id = toolCallId();
      toolCalls.push({ id, name: block.name, args: (block.input ?? {}) as Record<string, unknown> });
      echoed.push({ ...(block as Anthropic.Beta.BetaToolUseBlockParam), id });
    } else {
      echoed.push(block as ContentBlock);
    }
  }
  const message: AssistantMessage = {
    role: 'assistant',
    content: text,
    model: `anthropic:${final.model ?? model}`,
    echo: { provider: 'anthropic', model, data: echoed },
  };
  if (reasoning) message.reasoning = reasoning;
  if (toolCalls.length) message.toolCalls = toolCalls;
  return message;
}

/** `images: false` replaces attachments with a text placeholder (default: send them). */
export function toAnthropicMessages(messages: Message[], options: { images?: boolean } = {}): MessageParam[] {
  const out: MessageParam[] = [];
  const push = (role: 'user' | 'assistant', blocks: ContentBlock[]) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) (last.content as ContentBlock[]).push(...blocks);
    else out.push({ role, content: blocks });
  };

  for (const m of messages) {
    if (m.role === 'user') {
      const images = sendableImages(m);
      if (!images.length) {
        push('user', [{ type: 'text', text: m.content || '(empty message)' }]);
      } else if (options.images ?? true) {
        const blocks = images.map((img): ContentBlock => ({
          type: 'image',
          source: { type: 'base64', media_type: img.mimeType, data: img.data },
        }));
        if (m.content) blocks.push({ type: 'text', text: m.content });
        push('user', blocks);
      } else {
        const note = imagePlaceholder(images);
        push('user', [{ type: 'text', text: m.content ? `${m.content}\n\n${note}` : note }]);
      }
    } else if (m.role === 'tool') {
      push('user', [
        {
          type: 'tool_result',
          tool_use_id: m.toolCallId,
          content: m.content || '(no output)',
          ...(m.isError ? { is_error: true } : {}),
        },
      ]);
    } else if (m.echo?.provider === 'anthropic') {
      // Same provider: replay Claude's blocks verbatim (the API drops thinking a different Claude model can't use).
      push('assistant', m.echo.data as ContentBlock[]);
    } else {
      const blocks: ContentBlock[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const call of m.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args });
      }
      push('assistant', blocks);
    }
  }
  if (out[0]?.role !== 'user') out.unshift({ role: 'user', content: [{ type: 'text', text: '(continuing the task)' }] });
  return out;
}

function fromSdkError(err: unknown): ProviderError {
  const provider = 'anthropic';
  if (err instanceof ProviderError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new ProviderError('aborted', 'aborted', { provider });
  if (err instanceof Anthropic.APIConnectionError) {
    return new ProviderError(`anthropic: ${err.message}`, 'network', { provider });
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    const body = err.error as { error?: { type?: string; message?: string } } | undefined;
    const message = body?.error?.message ?? err.message;
    let kind;
    if (err instanceof Anthropic.RateLimitError) kind = 'rate_limit' as const;
    else if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) kind = 'auth' as const;
    else if (err instanceof Anthropic.NotFoundError) kind = 'model_not_found' as const;
    else if (err instanceof Anthropic.InternalServerError) kind = 'server' as const;
    else kind = classify(status, body?.error?.type ?? '', message);
    return new ProviderError(`anthropic: ${message}`, kind, {
      provider,
      status,
      retryAfterMs: kind === 'rate_limit' ? retryAfterFrom(err.headers as never, message) : undefined,
    });
  }
  return new ProviderError(`anthropic: ${err instanceof Error ? err.message : String(err)}`, 'network', { provider });
}
