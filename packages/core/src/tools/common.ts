import type { FileStat, Workspace } from '../workspace/types';
import { displayPath } from '../workspace/types';
import { toolError, type ToolContext, type ToolResult } from './types';
import * as posix from '../workspace/posix';

/**
 * Read-before-write guard: an edit is only allowed on a file the agent has
 * read, and that hasn't changed on disk since. This is what stops an agent
 * from clobbering a file based on a guess or a stale copy.
 */
export function checkFreshness(
  ctx: ToolContext,
  absPath: string,
  stat: FileStat,
  shown: string,
): ToolResult | null {
  const readAt = ctx.files.readMtime(absPath);
  if (readAt === undefined) {
    return toolError(
      `${shown} already exists and you haven't read it in this session. Read it with read_file first, then use edit_file for targeted changes.`,
    );
  }
  if (stat.mtimeMs > readAt + 1) {
    return toolError(`${shown} was modified on disk after you read it. Read it again before changing it.`);
  }
  return null;
}

export async function markWritten(ctx: ToolContext, absPath: string): Promise<void> {
  const st = await ctx.workspace.stat(absPath);
  if (st) ctx.files.markRead(absPath, st.mtimeMs);
}

/** "Did you mean …?" for a path that doesn't exist. */
export async function suggestSimilar(ws: Workspace, absPath: string): Promise<string> {
  const dir = ws.dirname(absPath);
  const name = posix.basename(absPath.replace(/\\/g, '/')).toLowerCase();
  const stem = name.replace(/\.[^.]+$/, '');
  try {
    const st = await ws.stat(dir);
    if (!st || st.type !== 'dir') return '';
    const entries = await ws.listDir(dir);
    const close = entries
      .map((e) => e.name)
      .filter((n) => {
        const lower = n.toLowerCase();
        return lower === name || lower.replace(/\.[^.]+$/, '') === stem;
      })
      .slice(0, 3);
    if (!close.length) return '';
    return ` Did you mean: ${close.map((n) => displayPath(ws, ws.join(dir, n))).join(', ')}?`;
  } catch {
    return '';
  }
}

/** Lines [from, to) with read_file-style numbering, capped. */
export function numberedLines(lines: string[], from: number, to: number, maxLines = 40): string {
  const end = Math.min(to, lines.length, from + maxLines);
  const width = String(end).length;
  const out: string[] = [];
  for (let i = Math.max(0, from); i < end; i++) {
    out.push(`${String(i + 1).padStart(width)}\t${lines[i]}`);
  }
  return out.join('\n');
}
