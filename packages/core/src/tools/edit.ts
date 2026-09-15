import { displayPath } from '../workspace/types';
import { checkFreshness, markWritten, numberedLines, suggestSimilar } from './common';
import { toolError, type PreparedCall, type Tool, type ToolContext, type ToolResult } from './types';

interface Args {
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export const editFileTool: Tool<Args> = {
  name: 'edit_file',
  description:
    'Change part of an existing file by exact string replacement. old_string must match the file exactly (including indentation) and be unique; include a few surrounding lines if needed, or set replace_all to change every occurrence. Do not include read_file line-number prefixes. Read the file first.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path, relative to the project root or absolute' },
      old_string: { type: 'string', description: 'Exact existing text to replace' },
      new_string: { type: 'string', description: 'Replacement text' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence instead of exactly one. Default false' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  kind: 'write',
  label: (a, ws) => `Edit ${displayPath(ws, ws.resolve(a.path))}`,
  paths: (a, ws) => [ws.resolve(a.path)],
  prepare: prepareEdit,
};

async function prepareEdit(args: Args, ctx: ToolContext): Promise<PreparedCall | ToolResult> {
  const ws = ctx.workspace;
  const abs = ws.resolve(args.path);
  const shown = displayPath(ws, abs);
  const st = await ws.stat(abs);

  if (!st) {
    if (args.old_string === '') return createFile(ctx, abs, shown, args.new_string);
    return toolError(`File not found: ${shown}.${await suggestSimilar(ws, abs)} Use write_file to create a new file.`);
  }
  if (st.type === 'dir') return toolError(`${shown} is a directory, not a file.`);
  const stale = checkFreshness(ctx, abs, st, shown);
  if (stale) return stale;
  if (args.old_string === '') {
    return toolError('old_string is empty. Copy the exact text you want to replace, or use write_file to replace the whole file.');
  }
  if (args.old_string === args.new_string) return toolError('old_string and new_string are identical; nothing would change.');

  const raw = await ws.readFile(abs);
  const crlf = raw.includes('\r\n');
  const text = crlf ? raw.replace(/\r\n/g, '\n') : raw;
  let oldS = lf(args.old_string);
  let newS = lf(args.new_string);
  let count = occurrences(text, oldS);

  // A frequent slip: pasting read_file output, line numbers and all.
  if (count === 0) {
    const stripped = stripLineNumbers(oldS);
    if (stripped !== null && occurrences(text, stripped) > 0) {
      oldS = stripped;
      newS = stripLineNumbers(newS) ?? newS;
      count = occurrences(text, oldS);
    }
  }
  if (count === 0) return toolError(notFound(text, oldS, shown));
  if (count > 1 && !args.replace_all) {
    const lines = occurrenceLines(text, oldS).slice(0, 12);
    return toolError(
      `old_string appears ${count} times in ${shown} (lines ${lines.join(', ')}). Include more surrounding lines so it matches exactly once, or set replace_all to true.`,
    );
  }

  const first = text.indexOf(oldS);
  const updated = args.replace_all
    ? text.split(oldS).join(newS)
    : text.slice(0, first) + newS + text.slice(first + oldS.length);
  const after = crlf ? updated.replace(/\n/g, '\r\n') : updated;
  const display = { type: 'diff' as const, path: shown, before: raw, after, created: false };
  const replaced = args.replace_all ? count : 1;

  return {
    preview: display,
    run: async () => {
      ctx.checkpoints.record(abs, raw);
      await ws.writeFile(abs, after);
      await markWritten(ctx, abs);
      return {
        content: `Edited ${shown}${replaced > 1 ? ` (${replaced} replacements)` : ''}. The changed region now reads:\n${regionAround(updated, first, newS.length)}`,
        summary: replaced > 1 ? `${replaced} replacements` : 'edited',
        display,
      };
    },
  };
}

async function createFile(ctx: ToolContext, abs: string, shown: string, content: string): Promise<PreparedCall> {
  const display = { type: 'diff' as const, path: shown, before: '', after: content, created: true };
  return {
    preview: display,
    run: async () => {
      ctx.checkpoints.record(abs, null);
      await ctx.workspace.writeFile(abs, content);
      await markWritten(ctx, abs);
      return { content: `Created ${shown}.`, summary: 'created', display };
    },
  };
}

function lf(s: string): string {
  return s.replace(/\r\n/g, '\n');
}

export function occurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function occurrenceLines(text: string, needle: string): number[] {
  const lines: number[] = [];
  let idx = text.indexOf(needle);
  while (idx !== -1) {
    lines.push(lineAt(text, idx));
    idx = text.indexOf(needle, idx + needle.length);
  }
  return lines;
}

/** Strip "12\t" / "12→" prefixes if (and only if) every non-empty line has one. */
export function stripLineNumbers(s: string): string | null {
  const lines = s.split('\n');
  const prefix = /^\s*\d+(?:\t|→)/;
  const nonEmpty = lines.filter((l) => l.trim() !== '');
  if (!nonEmpty.length || !nonEmpty.every((l) => prefix.test(l))) return null;
  return lines.map((l) => l.replace(prefix, '')).join('\n');
}

function notFound(text: string, oldS: string, shown: string): string {
  const fileLines = text.split('\n');
  const want = oldS.split('\n');
  while (want.length && !want[0]!.trim()) want.shift();
  while (want.length && !want[want.length - 1]!.trim()) want.pop();
  const norm = (l: string) => l.trim().replace(/\s+/g, ' ');
  const target = want.map(norm);

  if (target.length) {
    for (let i = 0; i + target.length <= fileLines.length; i++) {
      let same = true;
      for (let j = 0; j < target.length; j++) {
        if (norm(fileLines[i + j]!) !== target[j]) {
          same = false;
          break;
        }
      }
      if (same) {
        return `old_string was not found in ${shown} exactly, but lines ${i + 1}-${i + target.length} match apart from whitespace/indentation. The file has:\n${numberedLines(fileLines, i, i + target.length)}\nCopy that text exactly (without the line-number prefixes) and retry.`;
      }
    }
    const firstWanted = target.find((t) => t.length > 0);
    if (firstWanted) {
      const at = fileLines.findIndex((l) => norm(l) === firstWanted);
      if (at !== -1) {
        return `old_string was not found in ${shown}. Its first line matches line ${at + 1}, but the lines after it differ. The file has:\n${numberedLines(fileLines, at, at + target.length + 2)}\nCopy the exact current text and retry.`;
      }
    }
  }
  return `old_string was not found in ${shown}. Read the file again and copy the exact text to replace (without the line-number prefixes).`;
}

/** A few numbered lines around the replacement so the model can check its work. */
function regionAround(text: string, index: number, length: number): string {
  const lines = text.split('\n');
  const startLine = lineAt(text, index) - 1;
  const endLine = lineAt(text, index + Math.max(0, length - 1)) - 1;
  return numberedLines(lines, Math.max(0, startLine - 3), endLine + 4, 30);
}
