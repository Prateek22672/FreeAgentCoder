import { displayPath } from '../workspace/types';
import { isNoisyFile, looksBinary, walkFiles, type WalkEntry } from '../workspace/walk';
import * as posix from '../workspace/posix';
import { makeMatcher, relBelow } from './glob';
import { toolError, type Tool } from './types';

const MAX_FILE_BYTES = 1_000_000;
const MAX_LINE = 250;

interface Args {
  pattern: string;
  path?: string;
  glob?: string;
  ignore_case?: boolean;
  output?: 'content' | 'files' | 'count';
  context?: number;
  max_results?: number;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const grepTool: Tool<Args> = {
  name: 'grep',
  description:
    'Search file contents with a regular expression (JavaScript syntax), e.g. "function\\s+handleSubmit" or "TODO". Skips .gitignored files, node_modules and lockfiles. output: "content" (matching lines with line numbers; default), "files" (paths only) or "count".',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regular expression to search for' },
      path: { type: 'string', description: 'File or folder to search. Default: the project root' },
      glob: { type: 'string', description: 'Only search files matching this glob, e.g. "*.ts" or "src/**/*.py"' },
      ignore_case: { type: 'boolean', description: 'Case-insensitive search. Default false' },
      output: { type: 'string', enum: ['content', 'files', 'count'], description: 'Result format. Default "content"' },
      context: { type: 'integer', description: 'Lines of context around each match (0-5, content mode). Default 0' },
      max_results: { type: 'integer', description: 'Maximum matching lines (content mode). Default 100' },
    },
    required: ['pattern'],
  },
  kind: 'read',
  label: (a) => `Search /${a.pattern}/${a.glob ? ` in ${a.glob}` : ''}`,
  paths: (a, ws) => [ws.resolve(a.path ?? '.')],
  async prepare(args, ctx) {
    return {
      run: async () => {
        const ws = ctx.workspace;
        const flags = args.ignore_case ? 'i' : '';
        let regex: RegExp;
        let note = '';
        try {
          regex = new RegExp(args.pattern, flags);
        } catch {
          regex = new RegExp(escapeRegex(args.pattern), flags);
          note = `(Note: "${args.pattern}" is not a valid regular expression, so it was searched as plain text.)\n`;
        }

        const base = ws.resolve(args.path ?? '.');
        const st = await ws.stat(base);
        if (!st) return toolError(`Path not found: ${displayPath(ws, base)}`);
        const explicitFile = st.type === 'file';
        const baseRel = ws.relative(base);
        const include = args.glob ? makeMatcher(args.glob, ws) : null;
        const mode = args.output ?? 'content';
        const context = Math.min(5, Math.max(0, Math.floor(args.context ?? 0)));
        const maxResults = Math.max(1, Math.floor(args.max_results ?? 100));

        async function* candidates(): AsyncGenerator<WalkEntry> {
          if (explicitFile) {
            yield { abs: base, rel: baseRel, name: posix.basename(base.replace(/\\/g, '/')) };
            return;
          }
          yield* walkFiles(ws, base, { signal: ctx.signal });
        }

        const out: string[] = [];
        const counts: [string, number][] = [];
        let matchedLines = 0;
        let truncated = false;

        for await (const file of candidates()) {
          if (ctx.signal.aborted) break;
          if (include && !include(relBelow(baseRel, file.rel))) continue;
          if (!explicitFile && isNoisyFile(file.name)) continue;
          const fst = await ws.stat(file.abs);
          if (!fst || (!explicitFile && fst.size > MAX_FILE_BYTES)) continue;
          let text: string;
          try {
            text = await ws.readFile(file.abs);
          } catch {
            continue;
          }
          if (looksBinary(text)) continue;

          const lines = text.split(/\r?\n/);
          const hits: number[] = [];
          for (let i = 0; i < lines.length; i++) if (regex.test(lines[i]!)) hits.push(i);
          if (!hits.length) continue;
          const shown = displayPath(ws, file.abs);
          counts.push([shown, hits.length]);
          if (mode !== 'content') continue;

          let lastPrinted = -1;
          for (const hit of hits) {
            if (matchedLines >= maxResults) {
              truncated = true;
              break;
            }
            const from = Math.max(0, hit - context, lastPrinted + 1);
            const to = Math.min(lines.length - 1, hit + context);
            if (context && lastPrinted !== -1 && from > lastPrinted + 1) out.push('--');
            for (let i = from; i <= to; i++) {
              let line = lines[i]!;
              if (line.length > MAX_LINE) line = `${line.slice(0, MAX_LINE)}…`;
              out.push(`${shown}${i === hit ? ':' : '-'}${i + 1}${i === hit ? ':' : '-'} ${line}`);
            }
            lastPrinted = to;
            matchedLines++;
          }
          if (truncated) break;
        }

        const where = args.path ? ` in ${displayPath(ws, base)}` : '';
        if (!counts.length) return { content: `${note}No matches for /${args.pattern}/${where}.`, summary: 'no matches' };
        const total = counts.reduce((n, [, c]) => n + c, 0);
        const summary = `${total} match${total === 1 ? '' : 'es'} in ${counts.length} file${counts.length === 1 ? '' : 's'}`;

        if (mode === 'files') {
          const list = counts.slice(0, 200).map(([p]) => p);
          return { content: note + list.join('\n') + (counts.length > 200 ? `\n… ${counts.length - 200} more files` : ''), summary };
        }
        if (mode === 'count') {
          return { content: note + counts.map(([p, c]) => `${p}: ${c}`).join('\n') + `\nTotal: ${total}`, summary };
        }
        if (truncated) out.push(`… stopped after ${maxResults} matching lines. Narrow the pattern, path or glob to see more.`);
        return { content: note + out.join('\n'), summary };
      },
    };
  },
};
