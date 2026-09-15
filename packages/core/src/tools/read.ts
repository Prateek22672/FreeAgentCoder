import { displayPath } from '../workspace/types';
import { looksBinary } from '../workspace/walk';
import { suggestSimilar } from './common';
import { toolError, type Tool, type ToolContext, type ToolResult } from './types';

const MAX_LINES = 2000;
const MAX_LINE_CHARS = 2000;
const MAX_CHARS = 40_000;
const MAX_BYTES = 10 * 1024 * 1024;

interface Args {
  path: string;
  offset?: number;
  limit?: number;
}

export const readFileTool: Tool<Args> = {
  name: 'read_file',
  description:
    'Read a text file. Each output line starts with its line number and a tab ("12\\t…"); that prefix is not part of the file. Long files come back in pages — pass offset (1-based line) and limit to read further. Read a file before editing it.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path, relative to the project root or absolute' },
      offset: { type: 'integer', description: 'First line to return (1-based). Default 1' },
      limit: { type: 'integer', description: `Maximum lines to return. Default ${MAX_LINES}` },
    },
    required: ['path'],
  },
  kind: 'read',
  label: (a, ws) => `Read ${displayPath(ws, ws.resolve(a.path))}`,
  paths: (a, ws) => [ws.resolve(a.path)],
  async prepare(args, ctx) {
    return { run: () => readFile(args, ctx) };
  },
};

async function readFile(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const ws = ctx.workspace;
  const abs = ws.resolve(args.path);
  const shown = displayPath(ws, abs);
  const st = await ws.stat(abs);
  if (!st) return toolError(`File not found: ${shown}.${await suggestSimilar(ws, abs)}`);
  if (st.type === 'dir') return toolError(`${shown} is a directory. Use list_dir to see what's inside.`);
  if (st.size > MAX_BYTES) {
    return toolError(`${shown} is ${(st.size / 1e6).toFixed(1)} MB, too large to read. Use grep to find the part you need.`);
  }

  const text = await ws.readFile(abs);
  if (looksBinary(text)) {
    return { content: `${shown} is a binary file (${st.size} bytes); it can't be shown as text.`, summary: 'binary file' };
  }
  ctx.files.markRead(abs, st.mtimeMs);
  if (!text) return { content: `${shown} is empty.`, summary: 'empty file' };

  const notebook = /\.ipynb$/i.test(abs) ? renderNotebook(text) : null;
  const lines = (notebook ?? text).split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const total = lines.length;
  const start = Math.max(1, Math.floor(args.offset ?? 1));
  if (start > total) return toolError(`offset ${start} is past the end of ${shown} (${total} lines).`);
  const limit = Math.max(1, Math.floor(args.limit ?? MAX_LINES));
  const last = Math.min(total, start + limit - 1);
  const width = String(last).length;

  let out = '';
  let end = start - 1;
  for (let i = start - 1; i < last; i++) {
    let line = lines[i]!;
    if (line.length > MAX_LINE_CHARS) line = `${line.slice(0, MAX_LINE_CHARS)} … [line truncated]`;
    const next = `${String(i + 1).padStart(width)}\t${line}\n`;
    if (out.length + next.length > MAX_CHARS && end >= start) break;
    out += next;
    end = i + 1;
  }
  const partial = end < total;
  if (partial) out += `\n… showing lines ${start}-${end} of ${total}. Continue with offset=${end + 1}.`;
  return {
    content: out.trimEnd(),
    summary: `${notebook ? 'notebook, ' : ''}${partial || start > 1 ? `lines ${start}-${end} of ${total}` : `${total} lines`}`,
  };
}

interface NotebookJson {
  cells?: { cell_type?: string; source?: string | string[]; outputs?: unknown[] }[];
  metadata?: { language_info?: { name?: string }; kernelspec?: { language?: string } };
}

/**
 * Notebooks are JSON, and their outputs (often base64 images) dwarf the code.
 * Show only the cells, in order, so a model can read them within its budget.
 */
export function renderNotebook(json: string): string | null {
  let notebook: NotebookJson;
  try {
    notebook = JSON.parse(json) as NotebookJson;
  } catch {
    return null;
  }
  if (!Array.isArray(notebook.cells)) return null;
  const language = notebook.metadata?.language_info?.name ?? notebook.metadata?.kernelspec?.language ?? 'python';
  const parts = [
    `# Jupyter notebook (${language}), ${notebook.cells.length} cells; outputs hidden. This view is not the file's raw JSON: to change cells, run a short script (Python json or nbformat) rather than edit_file.`,
  ];
  notebook.cells.forEach((cell, index) => {
    const source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source ?? '');
    const outputs = cell.outputs?.length ? ` (${cell.outputs.length} output${cell.outputs.length === 1 ? '' : 's'} hidden)` : '';
    parts.push(`# %% [${cell.cell_type ?? 'code'}] cell ${index + 1}${outputs}\n${source.trimEnd()}`);
  });
  return parts.join('\n\n');
}
