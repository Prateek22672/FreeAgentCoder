import { displayPath, type Workspace } from '../workspace/types';
import { IGNORED_DIRS } from '../workspace/walk';
import { toolError, type Tool } from './types';

const MAX_ENTRIES = 400;

interface Args {
  path?: string;
  depth?: number;
}

export const listDirTool: Tool<Args> = {
  name: 'list_dir',
  description:
    'Show files and folders as an indented tree (default depth 2). Heavy folders like node_modules and .git are listed but not expanded.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Folder to list. Default: the project root' },
      depth: { type: 'integer', description: 'How many levels deep to go (1-6). Default 2' },
    },
  },
  kind: 'read',
  label: (a, ws) => `List ${displayPath(ws, ws.resolve(a.path ?? '.'))}`,
  paths: (a, ws) => [ws.resolve(a.path ?? '.')],
  async prepare(args, ctx) {
    return {
      run: async () => {
        const ws = ctx.workspace;
        const abs = ws.resolve(args.path ?? '.');
        const shown = displayPath(ws, abs);
        const st = await ws.stat(abs);
        if (!st) return toolError(`Folder not found: ${shown}`);
        if (st.type === 'file') return { content: `${shown} is a file (${st.size} bytes). Use read_file to read it.` };
        const depth = Math.min(6, Math.max(1, Math.floor(args.depth ?? 2)));
        const out: string[] = [];
        const truncated = await tree(ws, abs, depth, '', out);
        if (!out.length) return { content: `${shown} is empty.`, summary: 'empty' };
        if (truncated) out.push(`… more entries not shown. List a subfolder for detail.`);
        return { content: `${shown}/\n${out.join('\n')}`, summary: `${out.length} entries` };
      },
    };
  },
};

/** Returns true when the listing was cut off. */
async function tree(ws: Workspace, dirAbs: string, depth: number, indent: string, out: string[]): Promise<boolean> {
  let entries;
  try {
    entries = await ws.listDir(dirAbs);
  } catch {
    return false;
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  for (const entry of entries) {
    if (out.length >= MAX_ENTRIES) return true;
    if (entry.type === 'dir') {
      const skip = IGNORED_DIRS.has(entry.name) || entry.symlink;
      out.push(`${indent}  ${entry.name}/${skip ? '  (not expanded)' : ''}`);
      if (!skip && depth > 1) {
        if (await tree(ws, ws.join(dirAbs, entry.name), depth - 1, `${indent}  `, out)) return true;
      }
    } else {
      out.push(`${indent}  ${entry.name}`);
    }
  }
  return false;
}
