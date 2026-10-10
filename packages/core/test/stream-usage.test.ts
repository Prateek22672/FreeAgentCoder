import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatProvider } from '../src/providers/openai';

const sse = (...chunks: unknown[]) =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });

async function run(provider: OpenAICompatProvider) {
  const events = [];
  for await (const e of provider.stream({ model: 'm', system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [] })) events.push(e);
  return events;
}

afterEach(() => vi.unstubAllGlobals());

describe('stream usage', () => {
  it('asks for usage, so providers that only report it on request are counted', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return sse({ choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } });
    });
    const events = await run(new OpenAICompatProvider({ id: 'gemini', baseURL: 'https://x' }));
    expect(bodies[0]!.stream_options).toEqual({ include_usage: true });
    expect(events).toContainEqual({ type: 'usage', usage: { inputTokens: 12, outputTokens: 3 } });
  });

  it('drops the option for a server that rejects it, and still answers', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      if (body.stream_options) return new Response(JSON.stringify({ error: { message: 'Unknown field: stream_options' } }), { status: 422 });
      return sse({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] });
    });
    const provider = new OpenAICompatProvider({ id: 'strict', baseURL: 'https://x' });
    const events = await run(provider);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    await run(provider);
    expect(bodies.map((b) => 'stream_options' in b)).toEqual([true, false, false]);
  });
});
