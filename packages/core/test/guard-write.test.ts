import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeFileTool } from '../src/tools/write';
import { isPrepared } from '../src/tools/types';
import { LocalWorkspace } from '../src/node/local-workspace';

describe('the write guard', () => {
  it('refuses what the editor says not to write, before anything is written', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'fac-guard-'));
    const ctx = {
      workspace: new LocalWorkspace(root),
      signal: new AbortController().signal,
      files: { markRead() {}, readMtime: () => undefined, markLinesFresh() {}, markLinesMoved() {}, linesMovedFrom: () => undefined },
      checkpoints: { record() {} },
      todos: { get: () => [], set() {} },
      guardWrite: (abs: string, content: string) => (abs.endsWith('.py') && content.includes('import pptx') ? 'Not written: use make_deck.' : undefined),
    };
    const refused = await writeFileTool.prepare({ path: 'build_ppt.py', content: 'import pptx\n' }, ctx as never);
    expect(isPrepared(refused)).toBe(false);
    expect((refused as { content: string }).content).toContain('use make_deck');
    expect(existsSync(path.join(root, 'build_ppt.py'))).toBe(false);
    const allowed = await writeFileTool.prepare({ path: 'notes.txt', content: 'hello' }, ctx as never);
    expect(isPrepared(allowed)).toBe(true);
  });
});
