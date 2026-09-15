import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toAnthropicMessages } from '../src/providers/anthropic';
import { OpenAICompatProvider } from '../src/providers/openai';
import type { StreamEvent } from '../src/providers/types';
import type { AssistantMessage, Message } from '../src/types';

type Handler = (body: Record<string, unknown>, res: ServerResponse) => void;
let server: Server;
let baseURL: string;
let handler: Handler;
const received: Record<string, unknown>[] = [];

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      received.push(body);
      handler(body, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function sse(res: ServerResponse, chunks: unknown[]) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.end('data: [DONE]\n\n');
}

async function drain(gen: AsyncGenerator<StreamEvent>) {
  const events: StreamEvent[] = [];
  for await (const e of gen) events.push(e);
  const done = events.find((e) => e.type === 'done') as Extract<StreamEvent, { type: 'done' }>;
  return { events, message: done.message, stop: done.stopReason };
}

const request = (messages: Message[] = [{ role: 'user', content: 'hi' }]) => ({
  model: 'm1',
  system: 'sys',
  messages,
  tools: [{ name: 'read_file', description: 'read', parameters: { type: 'object', properties: { path: { type: 'string' } } } }],
});

describe('OpenAICompatProvider', () => {
  it('streams text, reasoning, usage and index-tagged tool calls', async () => {
    handler = (_b, res) =>
      sse(res, [
        { choices: [{ delta: { reasoning: 'thinking…' } }] },
        { choices: [{ delta: { content: 'Reading ' } }] },
        { choices: [{ delta: { content: 'now.' } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_x', function: { name: 'read_file', arguments: '{"pa' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.ts"}' } }] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        { x_groq: { usage: { prompt_tokens: 120, completion_tokens: 30 } }, choices: [] },
      ]);
    const p = new OpenAICompatProvider({ id: 'groq', baseURL, apiKey: 'k' });
    const { events, message, stop } = await drain(p.stream(request()));
    expect(message.content).toBe('Reading now.');
    expect(message.reasoning).toBe('thinking…');
    expect(message.toolCalls).toHaveLength(1);
    expect(message.toolCalls![0]).toMatchObject({ name: 'read_file', args: { path: 'a.ts' } });
    expect(message.toolCalls![0]!.id).toMatch(/^[a-zA-Z0-9]{9}$/);
    expect(stop).toBe('tool_use');
    expect(events).toContainEqual({ type: 'usage', usage: { inputTokens: 120, outputTokens: 30 } });
    expect(received.at(-1)).toMatchObject({ model: 'm1', stream: true });
  });

  it('handles Gemini-style whole tool calls without index and echoes thought signatures', async () => {
    handler = (_b, res) =>
      sse(res, [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { id: 'g1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' }, extra_content: { google: { thought_signature: 'SIG-A' } } },
                ],
              },
            },
          ],
        },
        { choices: [{ delta: { tool_calls: [{ id: 'g2', type: 'function', function: { name: 'read_file', arguments: '{"path":"b"}' } }] } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ]);
    const p = new OpenAICompatProvider({ id: 'gemini', baseURL, apiKey: 'k', thoughtSignatures: true });
    const { message } = await drain(p.stream(request()));
    expect(message.toolCalls!.map((c) => c.args.path)).toEqual(['a', 'b']);
    expect(message.echo).toMatchObject({ provider: 'gemini', model: 'm1', data: { signatures: ['SIG-A', undefined] } });

    // Next request: our signature goes back on the same provider+model.
    handler = (_b, res) => sse(res, [{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]);
    const history: Message[] = [
      { role: 'user', content: 'hi' },
      message,
      { role: 'tool', toolCallId: message.toolCalls![0]!.id, name: 'read_file', content: 'A' },
      { role: 'tool', toolCallId: message.toolCalls![1]!.id, name: 'read_file', content: 'B' },
    ];
    await drain(p.stream(request(history)));
    const sent = (received.at(-1)!.messages as Record<string, unknown>[])[2] as { tool_calls: Record<string, unknown>[] };
    expect(sent.tool_calls[0]!.extra_content).toEqual({ google: { thought_signature: 'SIG-A' } });
    expect(sent.tool_calls[1]!.extra_content).toBeUndefined();

    // A call produced by another provider gets Gemini's documented placeholder.
    const foreign: AssistantMessage = { role: 'assistant', content: '', toolCalls: [{ id: 'abcdefghi', name: 'read_file', args: { path: 'x' } }] };
    await drain(p.stream(request([{ role: 'user', content: 'hi' }, foreign, { role: 'tool', toolCallId: 'abcdefghi', name: 'read_file', content: 'X' }])));
    const sent2 = (received.at(-1)!.messages as Record<string, unknown>[])[2] as { tool_calls: Record<string, unknown>[] };
    expect(sent2.tool_calls[0]!.extra_content).toEqual({ google: { thought_signature: 'skip_thought_signature_validator' } });
  });

  it('maps HTTP errors to router-friendly kinds', async () => {
    handler = (_b, res) => {
      res.writeHead(413, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Request too large for model on tokens per minute (TPM): Limit 8000, Requested 12000' } }));
    };
    const p = new OpenAICompatProvider({ id: 'groq', baseURL, apiKey: 'k' });
    await expect(drain(p.stream(request()))).rejects.toMatchObject({ kind: 'too_large', status: 413 });

    handler = (_b, res) => {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '4' });
      res.end(JSON.stringify({ error: { message: 'Rate limit reached' } }));
    };
    await expect(drain(p.stream(request()))).rejects.toMatchObject({ kind: 'rate_limit', retryAfterMs: 4000 });
  });

  it('cleans leaked gpt-oss channel syntax out of tool names', async () => {
    handler = (_b, res) =>
      sse(res, [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'functions.read_file<|channel|>commentary', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }]);
    const p = new OpenAICompatProvider({ id: 'groq', baseURL });
    const { message } = await drain(p.stream(request()));
    expect(message.toolCalls![0]!.name).toBe('read_file');
  });

  it('accepts a non-streaming JSON answer', async () => {
    handler = (_b, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'plain' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 1 } }));
    };
    const p = new OpenAICompatProvider({ id: 'x', baseURL });
    expect((await drain(p.stream(request()))).message.content).toBe('plain');
  });
});

describe('toAnthropicMessages', () => {
  it('merges tool results into one user turn and starts with the user', () => {
    const msgs: Message[] = [
      { role: 'assistant', content: 'resumed', toolCalls: [{ id: 'aaaaaaaa1', name: 'read_file', args: { path: 'a' } }, { id: 'aaaaaaaa2', name: 'read_file', args: { path: 'b' } }] },
      { role: 'tool', toolCallId: 'aaaaaaaa1', name: 'read_file', content: 'A' },
      { role: 'tool', toolCallId: 'aaaaaaaa2', name: 'read_file', content: '', isError: true },
      { role: 'user', content: 'nudge', synthetic: true },
    ];
    const out = toAnthropicMessages(msgs);
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    const results = out[2]!.content as unknown as Record<string, unknown>[];
    expect(results.map((b) => b.type)).toEqual(['tool_result', 'tool_result', 'text']);
    expect(results[1]).toMatchObject({ content: '(no output)', is_error: true });
  });

  it('replays Claude blocks verbatim (thinking signatures) for Claude turns', () => {
    const blocks = [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: 'hi' }];
    const out = toAnthropicMessages([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'hi', echo: { provider: 'anthropic', model: 'claude-opus-5', data: blocks } },
    ]);
    expect(out[1]!.content).toEqual(blocks);
  });
});
