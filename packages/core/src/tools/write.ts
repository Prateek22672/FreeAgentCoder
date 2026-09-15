import { displayPath } from '../workspace/types';
import { countLines, plural } from '../util/text';
import { checkFreshness, markWritten } from './common';
import { toolError, type Tool } from './types';

interface Args {
  path: string;
  content: string;
}

export const writeFileTool: Tool<Args> = {
  name: 'write_file',
  description:
    'Create a new file, or replace an existing file completely (read it first). For changing part of an existing file use edit_file instead. Parent folders are created automatically.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path, relative to the project root or absolute' },
      content: { type: 'string', description: 'The complete content of the file' },
    },
    required: ['path', 'content'],
  },
  kind: 'write',
  label: (a, ws) => `Write ${displayPath(ws, ws.resolve(a.path))}`,
  paths: (a, ws) => [ws.resolve(a.path)],
  async prepare(args, ctx) {
    const ws = ctx.workspace;
    const abs = ws.resolve(args.path);
    const shown = displayPath(ws, abs);
    const st = await ws.stat(abs);
    if (st?.type === 'dir') return toolError(`${shown} is a directory, not a file.`);

    let before = '';
    if (st) {
      const stale = checkFreshness(ctx, abs, st, shown);
      if (stale) return stale;
      before = await ws.readFile(abs);
    }
    let content = args.content;
    // Keep the file's existing line-ending style.
    if (before.includes('\r\n') && !content.includes('\r\n')) content = content.replace(/\n/g, '\r\n');
    if (st && before === content) {
      return { content: `${shown} already has exactly this content; nothing changed.`, summary: 'unchanged' };
    }

    const display = { type: 'diff' as const, path: shown, before, after: content, created: !st };
    return {
      preview: display,
      run: async () => {
        ctx.checkpoints.record(abs, st ? before : null);
        await ws.writeFile(abs, content);
        await markWritten(ctx, abs);
        const lines = plural(countLines(content), 'line');
        return {
          content: `${st ? 'Rewrote' : 'Created'} ${shown} (${lines}).`,
          summary: `${st ? 'rewrote' : 'created'}, ${lines}`,
          display,
        };
      },
    };
  },
};
