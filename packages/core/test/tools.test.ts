import { beforeEach, describe, expect, it } from 'vitest';
import { CheckpointStore, FileReadTracker } from '../src/agent/state';
import { fileTools } from '../src/tools/index';
import { isPrepared, type Tool, type ToolContext, type ToolResult } from '../src/tools/types';
import { validateArgs } from '../src/tools/schema';
import { MemoryWorkspace } from '../src/workspace/memory';
import type { Todo } from '../src/types';

let ws: MemoryWorkspace;
let ctx: ToolContext;
let todos: Todo[];
const tools = Object.fromEntries(fileTools().map((t) => [t.name, t])) as Record<string, Tool>;

async function run(name: string, raw: Record<string, unknown>): Promise<ToolResult> {
  const tool = tools[name]!;
  const { value, errors } = validateArgs(tool.parameters, tool.normalize ? tool.normalize(raw) : raw);
  if (errors.length) throw new Error(errors.join('; '));
  const prepared = await tool.prepare(value, ctx);
  return isPrepared(prepared) ? prepared.run() : prepared;
}

beforeEach(() => {
  ws = new MemoryWorkspace({
    '/src/app.ts': 'export function add(a: number, b: number) {\n  return a + b;\n}\n\nexport const x = 1;\nexport const y = 1;\n',
    '/src/util/helpers.ts': 'export const helper = () => "TODO: implement";\n',
    '/crlf.txt': 'one\r\ntwo\r\nthree\r\n',
    '/dist/bundle.js': 'TODO in build output',
    '/package-lock.json': '{"TODO": true}',
    '/.gitignore': 'secret/\n*.log\n',
    '/secret/key.txt': 'TODO hidden',
    '/debug.log': 'TODO log',
    '/README.md': '# Demo\nTODO: docs\n',
  });
  todos = [];
  ctx = {
    workspace: ws,
    signal: new AbortController().signal,
    files: new FileReadTracker(),
    checkpoints: new CheckpointStore(),
    todos: { get: () => todos, set: (t) => (todos = t) },
  };
});

describe('read_file', () => {
  it('returns numbered lines', async () => {
    const r = await run('read_file', { path: 'src/app.ts' });
    expect(r.content.split('\n')[0]).toBe('1\texport function add(a: number, b: number) {');
    expect(r.summary).toBe('6 lines');
  });
  it('pages with offset/limit', async () => {
    const r = await run('read_file', { path: 'src/app.ts', offset: 2, limit: 2 });
    expect(r.content).toContain('2\t  return a + b;');
    expect(r.content).toContain('Continue with offset=4');
  });
  it('suggests near-miss file names', async () => {
    const r = await run('read_file', { path: 'src/App.ts' });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('Did you mean: src/app.ts');
  });
});

describe('edit_file', () => {
  it('refuses to edit a file that was not read', async () => {
    const r = await run('edit_file', { path: 'src/app.ts', old_string: 'a + b', new_string: 'a - b' });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("haven't read it");
  });

  it('replaces a unique match and shows the region', async () => {
    await run('read_file', { path: 'src/app.ts' });
    const r = await run('edit_file', { path: 'src/app.ts', old_string: 'return a + b;', new_string: 'return a - b;' });
    expect(r.isError).toBeFalsy();
    expect(await ws.readFile('/src/app.ts')).toContain('return a - b;');
    expect(r.content).toContain('2\t  return a - b;');
  });

  it('rejects ambiguous matches with line numbers, or replaces all', async () => {
    await run('read_file', { path: 'src/app.ts' });
    const ambiguous = await run('edit_file', { path: 'src/app.ts', old_string: '= 1;', new_string: '= 2;' });
    expect(ambiguous.content).toContain('appears 2 times');
    expect(ambiguous.content).toContain('lines 5, 6');
    const all = await run('edit_file', { path: 'src/app.ts', old_string: '= 1;', new_string: '= 2;', replace_all: true });
    expect(all.isError).toBeFalsy();
    expect(await ws.readFile('/src/app.ts')).not.toContain('= 1;');
  });

  it('points at a whitespace-only mismatch', async () => {
    await run('read_file', { path: 'src/app.ts' });
    const r = await run('edit_file', { path: 'src/app.ts', old_string: 'return  a + b;', new_string: 'x' });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('match apart from whitespace');
    expect(r.content).toContain('2\t  return a + b;');
  });

  it('accepts old_string pasted with line-number prefixes', async () => {
    await run('read_file', { path: 'src/app.ts' });
    const r = await run('edit_file', { path: 'src/app.ts', old_string: '2\t  return a + b;', new_string: '2\t  return a * b;' });
    expect(r.isError).toBeFalsy();
    expect(await ws.readFile('/src/app.ts')).toContain('  return a * b;');
  });

  it('keeps CRLF line endings', async () => {
    await run('read_file', { path: 'crlf.txt' });
    await run('edit_file', { path: 'crlf.txt', old_string: 'two\nthree', new_string: 'TWO\nTHREE' });
    expect(await ws.readFile('/crlf.txt')).toBe('one\r\nTWO\r\nTHREE\r\n');
  });

  it('detects files changed on disk after reading', async () => {
    await run('read_file', { path: 'src/app.ts' });
    await ws.writeFile('/src/app.ts', 'changed by someone else');
    const r = await run('edit_file', { path: 'src/app.ts', old_string: 'changed', new_string: 'x' });
    expect(r.content).toContain('modified on disk');
  });

  it('records a checkpoint that undo restores', async () => {
    const store = ctx.checkpoints as CheckpointStore;
    store.beginTurn();
    await run('read_file', { path: 'src/app.ts' });
    const before = await ws.readFile('/src/app.ts');
    await run('edit_file', { path: 'src/app.ts', old_string: 'a + b', new_string: 'a - b' });
    await run('write_file', { path: 'src/new.ts', content: 'new' });
    const undone = await store.undo(ws);
    expect(undone?.restored).toEqual(['/src/app.ts']);
    expect(undone?.deleted).toEqual(['/src/new.ts']);
    expect(await ws.readFile('/src/app.ts')).toBe(before);
    expect(await ws.stat('/src/new.ts')).toBeNull();
  });
});

describe('write_file', () => {
  it('creates new files and requires a read before overwriting', async () => {
    const created = await run('write_file', { path: 'src/new/file.ts', content: 'hi\n' });
    expect(created.content).toContain('Created src/new/file.ts');
    const blocked = await run('write_file', { path: 'src/app.ts', content: 'x' });
    expect(blocked.isError).toBe(true);
  });
});

describe('search tools', () => {
  it('grep skips .gitignored, build output and lockfiles', async () => {
    const r = await run('grep', { pattern: 'TODO' });
    expect(r.content).toContain('src/util/helpers.ts:1:');
    expect(r.content).toContain('README.md:2:');
    expect(r.content).not.toContain('secret');
    expect(r.content).not.toContain('debug.log');
    expect(r.content).not.toContain('dist/');
    expect(r.content).not.toContain('package-lock');
  });
  it('grep falls back to literal search for invalid regex', async () => {
    const r = await run('grep', { pattern: 'add(a', output: 'files' });
    expect(r.content).toContain('plain text');
    expect(r.content).toContain('src/app.ts');
  });
  it('glob matches names at any depth when the pattern has no slash', async () => {
    const r = await run('glob', { pattern: '*.ts' });
    expect(r.content.split('\n').sort()).toEqual(['src/app.ts', 'src/util/helpers.ts']);
  });
  it('list_dir shows a tree without expanding heavy folders', async () => {
    const r = await run('list_dir', {});
    expect(r.content).toContain('  src/');
    expect(r.content).toContain('    util/');
    expect(r.content).toContain('dist/  (not expanded)');
  });
});

describe('todo_write', () => {
  it('normalizes loose status values', async () => {
    const r = await run('todo_write', { todos: [{ content: 'a', status: 'done' }, { task: 'b', status: 'in-progress' }, 'c'] });
    expect(todos).toEqual([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'pending' },
    ]);
    expect(r.content).toContain('1/3 done');
  });
});
