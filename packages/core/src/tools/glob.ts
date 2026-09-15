import picomatch from 'picomatch';
import { displayPath, type Workspace } from '../workspace/types';
import { walkFiles } from '../workspace/walk';
import { toolError, type Tool } from './types';

const MAX_RESULTS = 200;

interface Args {
  pattern: string;
  path?: string;
}

/** Path of `rel` below `baseRel` ('' base = root). */
export function relBelow(baseRel: string, rel: string): string {
  if (!baseRel) return rel;
  return rel.startsWith(`${baseRel}/`) ? rel.slice(baseRel.length + 1) : rel;
}

export function makeMatcher(pattern: string, ws: Workspace): (path: string) => boolean {
  const clean = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  return picomatch(clean, {
    dot: true,
    // "*.ts" means "any .ts file", which is what models (and people) expect.
    basename: !clean.includes('/'),
    nocase: ws.caseInsensitive ?? false,
  });
}

export const globTool: Tool<Args> = {
  name: 'glob',
  description:
    'Find files by name pattern, e.g. "**/*.tsx", "src/**/*.test.ts" or "*.json" (a pattern without "/" matches file names at any depth). Returns up to 200 paths, most recently modified first.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern' },
      path: { type: 'string', description: 'Folder to search in. Default: the project root' },
    },
    required: ['pattern'],
  },
  kind: 'read',
  label: (a) => `Find ${a.pattern}`,
  paths: (a, ws) => [ws.resolve(a.path ?? '.')],
  async prepare(args, ctx) {
    return {
      run: async () => {
        const ws = ctx.workspace;
        const base = ws.resolve(args.path ?? '.');
        const st = await ws.stat(base);
        if (!st || st.type !== 'dir') return toolError(`Folder not found: ${displayPath(ws, base)}`);
        const baseRel = ws.relative(base);
        const isMatch = makeMatcher(args.pattern, ws);

        const found: { abs: string; rel: string }[] = [];
        for await (const entry of walkFiles(ws, base, { signal: ctx.signal })) {
          if (isMatch(relBelow(baseRel, entry.rel))) found.push(entry);
          if (found.length >= 2000) break;
        }
        if (!found.length) {
          return { content: `No files match "${args.pattern}"${args.path ? ` in ${displayPath(ws, base)}` : ''}.`, summary: 'no matches' };
        }
        const withTimes = await Promise.all(
          found.map(async (f) => ({ ...f, mtime: (await ws.stat(f.abs))?.mtimeMs ?? 0 })),
        );
        withTimes.sort((a, b) => b.mtime - a.mtime);
        const shown = withTimes.slice(0, MAX_RESULTS).map((f) => displayPath(ws, f.abs));
        const more = withTimes.length - shown.length;
        return {
          content: shown.join('\n') + (more > 0 ? `\n… ${more} more not shown; use a narrower pattern.` : ''),
          summary: `${withTimes.length} file${withTimes.length === 1 ? '' : 's'}`,
        };
      },
    };
  },
};
