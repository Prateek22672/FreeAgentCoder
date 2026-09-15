import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CheckpointStore, FileReadTracker } from '../src/agent/state';
import { buildRouter } from '../src/node/config';
import { htmlToText } from '../src/node/fetch-url';
import { LocalWorkspace } from '../src/node/local-workspace';
import { detectShell, processTool, ProcessRegistry, runCommandTool } from '../src/node/shell';
import { isPrepared, type ToolContext, type ToolResult } from '../src/tools/types';

const dir = mkdtempSync(path.join(tmpdir(), 'agentic-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ws = new LocalWorkspace(dir);
const ctx = (signal = new AbortController().signal, onOutput?: (c: string) => void): ToolContext => ({
  workspace: ws,
  signal,
  files: new FileReadTracker(),
  checkpoints: new CheckpointStore(),
  todos: { get: () => [], set: () => {} },
  onOutput,
});

describe('LocalWorkspace', () => {
  it('resolves relative, project-rooted and Git Bash style paths', () => {
    expect(ws.resolve('src/a.ts')).toBe(path.join(dir, 'src', 'a.ts'));
    expect(ws.isInside(ws.resolve('src/a.ts'))).toBe(true);
    expect(ws.isInside(ws.resolve('../outside.txt'))).toBe(false);
    expect(ws.relative(path.join(dir, 'src', 'a.ts'))).toBe('src/a.ts');
    if (process.platform === 'win32') {
      expect(ws.resolve('/src/a.ts')).toBe(path.join(dir, 'src', 'a.ts'));
      expect(ws.resolve('/c/Users/x')).toBe('C:\\Users\\x');
    }
  });

  it('writes with parent folders and lists entries', async () => {
    await ws.writeFile(ws.resolve('deep/nested/file.txt'), 'hi');
    expect(await ws.readFile(ws.resolve('deep/nested/file.txt'))).toBe('hi');
    expect((await ws.listDir(ws.resolve('deep'))).map((e) => e.name)).toEqual(['nested']);
  });
});

describe('run_command', () => {
  const shell = detectShell();
  const registry = new ProcessRegistry();
  const tool = runCommandTool(shell, registry);

  async function run(args: { command: string; timeout?: number; background?: boolean }, c = ctx()): Promise<ToolResult> {
    const prepared = await tool.prepare(args, c);
    return isPrepared(prepared) ? prepared.run() : prepared;
  }

  it('runs a command in the project folder and streams output', async () => {
    writeFileSync(path.join(dir, 'marker.txt'), 'x');
    const chunks: string[] = [];
    const r = await run({ command: shell.kind === 'powershell' ? 'Get-ChildItem -Name marker.txt' : 'ls marker.txt && echo hello' }, ctx(undefined, (c) => chunks.push(c)));
    expect(r.content).toContain('Exit code: 0');
    expect(r.content).toContain('marker.txt');
    expect(chunks.join('')).toContain('marker.txt');
  });

  it('reports failures with the exit code', async () => {
    const r = await run({ command: 'exit 3' });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('Exit code: 3');
  });

  it('stops commands that exceed the timeout', async () => {
    const r = await run({ command: 'node -e "setTimeout(() => {}, 60000)"', timeout: 1 });
    expect(r.content).toContain('Timed out');
  });

  it('starts, inspects and stops background processes', async () => {
    const r = await run({ command: 'node -e "console.log(\'server ready on http://localhost:5999\'); setInterval(() => {}, 1000)"', background: true });
    expect(r.content).toContain('Started background process p1');
    expect(r.content).toContain('localhost:5999');
    const proc = processTool(registry);
    const prepared = await proc.prepare({ action: 'list' }, ctx());
    const listed = isPrepared(prepared) ? await prepared.run() : prepared;
    expect(listed.content).toContain('p1');
    registry.killAll();
  }, 30_000);
});

describe('buildRouter', () => {
  it('uses only free providers that have keys, never paid ones automatically', () => {
    const { router } = buildRouter({ keys: { groq: 'g', anthropic: 'a', gemini: 'm' } });
    expect(router.chain.map((e) => e.provider.id)).toEqual(['gemini', 'groq']);
  });
  it('puts an explicitly chosen paid model first', () => {
    const { router } = buildRouter({ keys: { anthropic: 'a', groq: 'g' }, model: 'anthropic:claude-opus-5' });
    expect(router.chain.map((e) => `${e.provider.id}:${e.model}`)).toEqual(['anthropic:claude-opus-5', 'groq:openai/gpt-oss-120b']);
  });
  it('warns about a chosen model without a key', () => {
    const { warnings } = buildRouter({ model: 'cerebras:gpt-oss-120b' });
    expect(warnings[0]).toContain('CEREBRAS_API_KEY');
  });
});

describe('htmlToText', () => {
  it('keeps readable text, headings and links', () => {
    const text = htmlToText('<html><head><title>x</title><style>a{}</style></head><body><h2>Install</h2><p>Run <code>npm i</code> &amp; go.</p><a href="https://a.dev/x">Docs</a><script>evil()</script></body></html>');
    expect(text).toContain('## Install');
    expect(text).toContain('Run npm i & go.');
    expect(text).toContain('[Docs](https://a.dev/x)');
    expect(text).not.toContain('evil');
  });
});
