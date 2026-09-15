import { describe, expect, it } from 'vitest';
import { extractTextToolCalls } from '../src/agent/textcalls';
import { announcesAction } from '../src/agent/agent';
import { classify, parseDuration, retryAfterFrom } from '../src/providers/errors';
import { pickModel, parseModelRef } from '../src/providers/presets';
import { validateArgs } from '../src/tools/schema';
import { parseToolArgs } from '../src/util/json';
import { cleanModelText, collapseCarriageReturns, stripAnsi, truncateMiddle } from '../src/util/text';

describe('parseToolArgs', () => {
  it('parses normal JSON', () => {
    expect(parseToolArgs('{"path":"a.ts"}')).toEqual({ ok: true, value: { path: 'a.ts' } });
  });
  it('repairs raw newlines inside strings (file content written by weak models)', () => {
    const raw = '{"path":"a.ts","content":"line1\nline2\n\tindented"}';
    const r = parseToolArgs(raw);
    expect(r.ok && r.value.content).toBe('line1\nline2\n\tindented');
  });
  it('drops trailing commas and code fences', () => {
    const r = parseToolArgs('```json\n{"a": [1, 2,], "b": 3,}\n```');
    expect(r).toEqual({ ok: true, value: { a: [1, 2], b: 3 } });
  });
  it('unwraps double-encoded JSON', () => {
    expect(parseToolArgs(JSON.stringify(JSON.stringify({ x: 1 })))).toEqual({ ok: true, value: { x: 1 } });
  });
  it('treats empty arguments as {}', () => {
    expect(parseToolArgs('')).toEqual({ ok: true, value: {} });
  });
  it('reports garbage', () => {
    expect(parseToolArgs('{"path": ').ok).toBe(false);
  });
});

describe('validateArgs', () => {
  const schema = {
    type: 'object',
    properties: { path: { type: 'string' }, limit: { type: 'integer' }, all: { type: 'boolean' } },
    required: ['path'],
  };
  it('maps Claude-style aliases and coerces types', () => {
    const r = validateArgs(schema, { file_path: 'x.ts', limit: '20', all: 'true' });
    expect(r.errors).toEqual([]);
    expect(r.value).toEqual({ path: 'x.ts', limit: 20, all: true });
  });
  it('treats null as absent and reports missing required fields', () => {
    const r = validateArgs(schema, { limit: null });
    expect(r.errors).toEqual(['missing required parameter "path"']);
  });
  it('rejects enum violations', () => {
    const r = validateArgs({ type: 'object', properties: { mode: { type: 'string', enum: ['a', 'b'] } } }, { mode: 'c' });
    expect(r.errors[0]).toContain('must be one of');
  });
});

describe('text helpers', () => {
  it('truncates the middle and keeps the end', () => {
    const out = truncateMiddle('a'.repeat(100) + 'END', 40);
    expect(out.endsWith('END')).toBe(true);
    expect(out).toContain('omitted');
  });
  it('strips ANSI and progress-bar redraws', () => {
    expect(stripAnsi('[32mok[0m')).toBe('ok');
    expect(collapseCarriageReturns('10%\r50%\r100%\ndone')).toBe('100%\ndone');
  });
  it('removes leaked chat-template tokens and think blocks', () => {
    expect(cleanModelText('<think>hmm</think>Hello<|end|>')).toBe('Hello');
  });
});

describe('error classification', () => {
  it('maps Groq-style responses', () => {
    expect(classify(413, '', 'Request too large for model on tokens per minute (TPM)')).toBe('too_large');
    expect(classify(429, 'rate_limit_exceeded', 'Rate limit reached. Please try again in 7.5s')).toBe('rate_limit');
    expect(classify(400, 'tool_use_failed', 'Failed to call a function')).toBe('bad_tool_call');
    expect(classify(404, 'model_not_found', 'The model `x` does not exist')).toBe('model_not_found');
    expect(classify(401, '', 'Invalid API Key')).toBe('auth');
    expect(classify(503, '', 'overloaded')).toBe('server');
  });
  it('parses retry hints', () => {
    expect(parseDuration('2m59.5s')).toBe(179_500);
    expect(parseDuration('250ms')).toBe(250);
    expect(retryAfterFrom({ 'retry-after': '3' }, '')).toBe(3000);
    expect(retryAfterFrom(undefined, 'Please try again in 7.5s')).toBe(7500);
    expect(retryAfterFrom(undefined, 'Please retry in 34.2s.')).toBe(34_200);
  });
});

describe('model refs', () => {
  it('parses provider:model, keeping colons in model ids', () => {
    expect(parseModelRef('openrouter:foo/bar:free')).toEqual({ provider: 'openrouter', model: 'foo/bar:free' });
    expect(parseModelRef('groq')).toEqual({ provider: 'groq', model: 'openai/gpt-oss-120b' });
  });
  it('picks the newest matching model', () => {
    expect(pickModel(['gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'], [/^gemini-[\d.]+-flash$/])).toBe('gemini-3.8-flash');
  });
});

describe('text tool-call recovery', () => {
  const names = new Set(['read_file', 'write_file']);
  it('recovers <tool_call> blocks', () => {
    const r = extractTextToolCalls('Sure.\n<tool_call>{"name":"read_file","arguments":{"path":"a.ts"}}</tool_call>', names);
    expect(r?.calls[0]).toMatchObject({ name: 'read_file', args: { path: 'a.ts' } });
    expect(r?.text).toBe('Sure.');
  });
  it('recovers a bare JSON call', () => {
    const r = extractTextToolCalls('```json\n{"name": "write_file", "parameters": {"path": "b", "content": "x"}}\n```', names);
    expect(r?.calls[0]?.name).toBe('write_file');
  });
  it('ignores unknown tools and prose', () => {
    expect(extractTextToolCalls('{"name":"rm_rf","arguments":{}}', names)).toBeNull();
    expect(extractTextToolCalls('Just text {not a call}', names)).toBeNull();
  });
});

describe('announcesAction', () => {
  it('spots "let me …" endings but not polite sign-offs', () => {
    expect(announcesAction('I found the bug. Let me fix it now.')).toBe(true);
    expect(announcesAction('Next I will update the config:')).toBe(true);
    expect(announcesAction('All done! Let me know if you want changes.')).toBe(false);
    expect(announcesAction('Shall I also add tests?')).toBe(false);
    expect(announcesAction('Fixed the bug in src/app.ts:12.')).toBe(false);
  });
});
