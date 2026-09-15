import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Agent } from '../src/agent/agent';
import { microCompact, transcript } from '../src/agent/context';
import { PermissionPolicy } from '../src/agent/permissions';
import { saveSession } from '../src/node/sessions';
import { AnthropicProvider, toAnthropicMessages } from '../src/providers/anthropic';
import {
  IMAGE_TOKEN_ESTIMATE,
  imagePlaceholder,
  modelSupportsImages,
  normalizeImage,
  stripImageData,
} from '../src/providers/images';
import { OpenAICompatProvider } from '../src/providers/openai';
import { createProvider, PRESETS } from '../src/providers/presets';
import { estimateRequestTokens, ModelRouter } from '../src/providers/router';
import type { ChatRequest } from '../src/providers/types';
import { fileTools } from '../src/tools/index';
import type { ImagePart, Message, UserMessage } from '../src/types';
import { MemoryWorkspace } from '../src/workspace/memory';
import { collect, say, ScriptedProvider, type Step } from './helpers';

const PNG: ImagePart = { mimeType: 'image/png', data: 'UE5HREFUQQ==', name: 'screen.png' };
const JPG: ImagePart = { mimeType: 'image/jpeg', data: 'SlBHREFUQQ==', name: 'error.png' };

const req = (model: string, messages: Message[]): ChatRequest => ({ model, system: 'sys', messages, tools: [] });

describe('modelSupportsImages', () => {
  const table: [string, string, boolean][] = [
    // gemini
    ['gemini', 'gemini-3.8-flash', true],
    ['gemini', 'gemini-2.5-flash', true],
    ['gemini', 'gemini-3.5-flash-lite', true],
    ['gemini', 'models/gemini-2.5-pro', true],
    ['gemini', 'gemma-3-27b-it', true],
    ['gemini', 'gemma-4-12b-it', true],
    ['gemini', 'gemma-3-1b-it', false],
    ['gemini', 'gemma-2-9b-it', false],
    // anthropic
    ['anthropic', 'claude-opus-5', true],
    ['anthropic', 'claude-haiku-4-5', true],
    ['anthropic', 'some-proxy-model', false],
    // openai
    ['openai', 'gpt-5', true],
    ['openai', 'gpt-5-mini', true],
    ['openai', 'gpt-4o', true],
    ['openai', 'gpt-4o-mini', true],
    ['openai', 'gpt-4.1-nano', true],
    ['openai', 'o3', true],
    ['openai', 'o4-mini', true],
    ['openai', 'o3-mini', false],
    ['openai', 'gpt-4o-audio-preview', false],
    ['openai', 'gpt-3.5-turbo', false],
    // groq
    ['groq', 'meta-llama/llama-4-scout-17b-16e-instruct', true],
    ['groq', 'openai/gpt-oss-120b', false],
    ['groq', 'qwen/qwen3.8-27b', false],
    // mistral
    ['mistral', 'mistral-medium-latest', true],
    ['mistral', 'mistral-small-latest', true],
    ['mistral', 'pixtral-large-latest', true],
    ['mistral', 'magistral-medium-latest', true],
    ['mistral', 'codestral-latest', false],
    ['mistral', 'mistral-large-latest', false],
    // openrouter
    ['openrouter', 'openrouter/free', false],
    ['openrouter', 'nex-agi/nex-n2.5-pro:free', false],
    ['openrouter', 'cohere/north-mini-code:free', false],
    ['openrouter', 'google/gemini-2.5-flash', true],
    ['openrouter', 'anthropic/claude-sonnet-5', true],
    ['openrouter', 'openai/gpt-4o-mini', true],
    ['openrouter', 'meta-llama/llama-4-maverick:free', true],
    ['openrouter', 'qwen/qwen2.5-vl-72b-instruct:free', true],
    ['openrouter', 'qwen/qwen3vl-8b', true],
    ['openrouter', 'meta-llama/llama-3.2-11b-vision-instruct', true],
    ['openrouter', 'google/gemma-3-27b-it:free', true],
    ['openrouter', 'mistralai/pixtral-12b', true],
    ['openrouter', 'openai/gpt-oss-120b:free', false],
    // text-only / unknown
    ['cerebras', 'gpt-oss-120b', false],
    ['cerebras', 'qwen-3.8-27b', false],
    ['ollama', 'qwen3-coder:30b', false],
    ['my-proxy', 'gpt-4o', false],
    ['custom', 'claude-opus-5', false],
  ];
  it.each(table)('%s:%s → %s', (provider, model, expected) => {
    expect(modelSupportsImages(provider, model)).toBe(expected);
  });

  it('classifies every preset default sensibly', () => {
    const defaults = Object.fromEntries(Object.values(PRESETS).map((p) => [p.id, modelSupportsImages(p.id, p.defaultModel)]));
    expect(defaults).toEqual({
      gemini: true,
      groq: false,
      cerebras: false,
      mistral: true,
      openrouter: false,
      ollama: false,
      openai: true,
      anthropic: true,
    });
  });
});

describe('OpenAI-compatible body', () => {
  const baseURL = 'http://127.0.0.1:1/v1';

  it('leaves messages without images unchanged', () => {
    const p = new OpenAICompatProvider({ id: 'gemini', baseURL });
    const body = p.buildBody(req('gemini-3.8-flash', [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }]));
    expect(body).toEqual({
      model: 'gemini-3.8-flash',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
      stream: true,
    });
  });

  it('sends image_url parts to a vision model', () => {
    const p = new OpenAICompatProvider({ id: 'gemini', baseURL });
    const body = p.buildBody(req('gemini-3.8-flash', [{ role: 'user', content: 'what is wrong?', images: [PNG, JPG] }]));
    expect((body.messages as unknown[])[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'what is wrong?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,UE5HREFUQQ==' } },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,SlBHREFUQQ==' } },
      ],
    });
  });

  it('sends a placeholder to a text-only model', () => {
    const p = new OpenAICompatProvider({ id: 'groq', baseURL });
    const body = p.buildBody(req('openai/gpt-oss-120b', [{ role: 'user', content: 'what is wrong?', images: [PNG, JPG] }]));
    const sent = (body.messages as { content: unknown }[])[1]!;
    expect(sent.content).toBe(
      "what is wrong?\n\n[2 images attached (screen.png, error.png) — this model can't view images; rely on the description in the message.]",
    );
    expect(JSON.stringify(body)).not.toContain(PNG.data);
  });

  it('treats unknown provider ids as text-only and honours the supportsImages option', () => {
    const messages: Message[] = [{ role: 'user', content: 'look', images: [PNG] }];
    const custom = new OpenAICompatProvider({ id: 'my-proxy', baseURL });
    expect(typeof (custom.buildBody(req('gpt-4o', messages)).messages as { content: unknown }[])[1]!.content).toBe('string');

    const forced = new OpenAICompatProvider({ id: 'my-proxy', baseURL, supportsImages: true });
    expect(Array.isArray((forced.buildBody(req('llava', messages)).messages as { content: unknown }[])[1]!.content)).toBe(true);

    const byModel = new OpenAICompatProvider({ id: 'gemini', baseURL, supportsImages: (m) => m.includes('vision') });
    expect(byModel.supportsImages('gemini-3.8-flash')).toBe(false);
    expect(byModel.supportsImages('x-vision')).toBe(true);

    const viaPreset = createProvider(PRESETS.ollama!, { supportsImages: true }) as OpenAICompatProvider;
    expect(viaPreset.supportsImages('llava')).toBe(true);
  });

  it('handles an image-only message', () => {
    const p = new OpenAICompatProvider({ id: 'openai', baseURL });
    const vision = p.buildBody(req('gpt-5', [{ role: 'user', content: '', images: [{ mimeType: 'image/webp', data: 'AAAA' }] }]));
    expect((vision.messages as unknown[])[1]).toEqual({
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'data:image/webp;base64,AAAA' } }],
    });
    const text = new OpenAICompatProvider({ id: 'cerebras', baseURL }).buildBody(
      req('gpt-oss-120b', [{ role: 'user', content: '', images: [{ mimeType: 'image/webp', data: 'AAAA' }] }]),
    );
    expect((text.messages as { content: unknown }[])[1]!.content).toBe(imagePlaceholder([{ mimeType: 'image/webp', data: 'AAAA' }]));
  });
});

describe('Anthropic messages', () => {
  it('puts image blocks before the text block', () => {
    const out = toAnthropicMessages([{ role: 'user', content: 'what is wrong?', images: [PNG, JPG] }]);
    expect(out).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.data } },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: JPG.data } },
          { type: 'text', text: 'what is wrong?' },
        ],
      },
    ]);
  });

  it('uses a placeholder when images are disabled', () => {
    const out = toAnthropicMessages([{ role: 'user', content: 'look', images: [PNG] }], { images: false });
    expect(out[0]!.content).toEqual([{ type: 'text', text: `look\n\n${imagePlaceholder([PNG])}` }]);
  });

  it('defaults to images for Claude models only, overridable', () => {
    expect(new AnthropicProvider({ apiKey: 'k' }).supportsImages('claude-opus-5')).toBe(true);
    expect(new AnthropicProvider({ apiKey: 'k' }).supportsImages('proxy-model')).toBe(false);
    expect(new AnthropicProvider({ apiKey: 'k', supportsImages: false }).supportsImages('claude-opus-5')).toBe(false);
  });
});

describe('image token budgeting and compaction', () => {
  it('counts each image in the request estimate', () => {
    const plain = estimateRequestTokens('sys', [{ role: 'user', content: 'look' }], []);
    const withImages = estimateRequestTokens('sys', [{ role: 'user', content: 'look', images: [PNG, JPG] }], []);
    expect(withImages - plain).toBe(2 * IMAGE_TOKEN_ESTIMATE);
  });

  it('micro-compaction drops images from earlier requests but keeps the latest', () => {
    const messages: Message[] = [
      { role: 'user', content: 'first', images: [PNG] },
      { role: 'assistant', content: 'seen' },
      { role: 'user', content: 'second', images: [JPG] },
      { role: 'user', content: 'nudge', synthetic: true },
    ];
    const saved = microCompact(messages);
    expect(saved).toBeGreaterThan(IMAGE_TOKEN_ESTIMATE - 50);
    const first = messages[0] as UserMessage;
    expect(first.images).toBeUndefined();
    expect(first.content).toContain('screen.png');
    expect((messages[2] as UserMessage).images).toEqual([JPG]);
  });

  it('transcripts name attachments without their data', () => {
    const text = transcript([{ role: 'user', content: 'look', images: [PNG] }], 10_000);
    expect(text).toContain('USER: look [1 image (screen.png) attached]');
    expect(text).not.toContain(PNG.data);
  });

  it('summary compaction drops image data and keeps names, without duplicating images', async () => {
    let summaryRequest: ChatRequest | undefined;
    const script: Step[] = [
      (r) => {
        summaryRequest = r;
        return { role: 'assistant', content: 'SUMMARY: user shared a screenshot.' };
      },
    ];
    const provider = new ScriptedProvider(script);
    const agent = new Agent({
      router: new ModelRouter([{ provider, model: 'fake', contextWindow: 200_000 }]),
      workspace: new MemoryWorkspace({}),
      tools: fileTools(),
      systemPrompt: 't',
      permissions: new PermissionPolicy('auto-edit'),
      messages: [
        { role: 'user', content: 'fix this', images: [PNG] },
        { role: 'assistant', content: 'Looking.' },
        { role: 'user', content: 'and this', images: [JPG] },
        { role: 'assistant', content: 'Done.' },
      ],
    });
    // Manual compaction keeps the last 2 messages; the first request (with screen.png) is summarized.
    await collect(agent.compact());
    expect(summaryRequest!.messages).toHaveLength(1);
    expect((summaryRequest!.messages[0] as UserMessage).images).toBeUndefined();
    expect(summaryRequest!.messages[0]!.content).toContain('screen.png');
    expect(JSON.stringify(summaryRequest)).not.toContain(PNG.data);

    expect(agent.messages[0]).toMatchObject({ role: 'user', synthetic: true });
    expect((agent.messages[0] as UserMessage).images).toBeUndefined();
    expect(JSON.stringify(agent.messages)).not.toContain(PNG.data);
    // The kept tail is untouched.
    expect((agent.messages[1] as UserMessage).images).toEqual([JPG]);
  });

  it('keeps the names of a summarized latest request in the compaction message', async () => {
    const provider = new ScriptedProvider([() => ({ role: 'assistant', content: 'SUMMARY.' })]);
    const agent = new Agent({
      router: new ModelRouter([{ provider, model: 'fake', contextWindow: 200_000 }]),
      workspace: new MemoryWorkspace({}),
      tools: fileTools(),
      systemPrompt: 't',
      messages: [
        { role: 'user', content: 'fix this', images: [PNG] },
        { role: 'assistant', content: 'Step one.' },
        { role: 'assistant', content: 'Step two.' },
        { role: 'assistant', content: 'Step three.' },
      ],
    });
    await collect(agent.compact());
    const summary = agent.messages[0]!.content;
    expect(summary).toContain('fix this');
    expect(summary).toContain('screen.png');
    expect(JSON.stringify(agent.messages)).not.toContain(PNG.data);
  });
});

describe('Agent input with images', () => {
  it('puts the images on the user message and sends them to the model', async () => {
    const provider = new ScriptedProvider([say('It is a stack trace.')]);
    const agent = new Agent({
      router: new ModelRouter([{ provider, model: 'fake', contextWindow: 200_000 }]),
      workspace: new MemoryWorkspace({}),
      tools: fileTools(),
      systemPrompt: 't',
    });
    const events = await collect(agent.run('what is this?', { images: [PNG, { mimeType: 'image/png', data: 'data:image/jpeg;base64,QUJD' }] }));
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'completed' });
    expect(agent.messages[0]).toEqual({
      role: 'user',
      content: 'what is this?',
      images: [PNG, { mimeType: 'image/jpeg', data: 'QUJD' }],
    });
    expect((provider.requests[0]!.messages[0] as UserMessage).images).toHaveLength(2);
  });

  it('adds no images field when none are given', async () => {
    const provider = new ScriptedProvider([say('ok')]);
    const agent = new Agent({
      router: new ModelRouter([{ provider, model: 'fake', contextWindow: 200_000 }]),
      workspace: new MemoryWorkspace({}),
      tools: fileTools(),
      systemPrompt: 't',
    });
    await collect(agent.run('hi', { images: [] }));
    expect(agent.messages[0]).toEqual({ role: 'user', content: 'hi' });
  });

  it('normalizeImage leaves raw base64 alone', () => {
    expect(normalizeImage(PNG)).toEqual(PNG);
  });
});

describe('session files', () => {
  it('stripImageData keeps names but not data, without touching the live messages', () => {
    const live: Message[] = [{ role: 'user', content: 'look', images: [PNG] }, { role: 'assistant', content: 'ok' }];
    const saved = stripImageData(live);
    expect((saved[0] as UserMessage).images).toBeUndefined();
    expect(saved[0]!.content).toContain('screen.png');
    expect((live[0] as UserMessage).images).toEqual([PNG]);
    expect(saved[1]).toBe(live[1]);
  });

  it('saveSession does not write base64 image data', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'agentic-img-'));
    const previous = process.env.AGENTIC_HOME;
    process.env.AGENTIC_HOME = home;
    try {
      const messages: Message[] = [{ role: 'user', content: 'look', images: [PNG] }];
      await saveSession({
        id: 's1',
        cwd: home,
        title: 'look',
        createdAt: '',
        updatedAt: '',
        model: 'x:y',
        messages,
        todos: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      });
      const dir = path.join(home, 'sessions');
      const [project] = await readdir(dir);
      const raw = await readFile(path.join(dir, project!, 's1.json'), 'utf8');
      expect(raw).not.toContain(PNG.data);
      expect(raw).toContain('screen.png');
      expect((messages[0] as UserMessage).images).toEqual([PNG]);
    } finally {
      if (previous === undefined) delete process.env.AGENTIC_HOME;
      else process.env.AGENTIC_HOME = previous;
      await rm(home, { recursive: true, force: true });
    }
  });
});
