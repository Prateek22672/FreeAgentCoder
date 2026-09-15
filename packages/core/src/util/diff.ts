import { structuredPatch } from 'diff';

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'gap';
  text: string;
  /** Line number in the old (del/ctx) or new (add) file. */
  line?: number;
}

/** Compact, UI-ready diff: changed lines with a little context, gaps between hunks. */
export function lineDiff(before: string, after: string, context = 2): DiffLine[] {
  const patch = structuredPatch('a', 'b', before.replace(/\r\n/g, '\n'), after.replace(/\r\n/g, '\n'), '', '', { context });
  const out: DiffLine[] = [];
  patch.hunks.forEach((hunk, i) => {
    if (i > 0) out.push({ kind: 'gap', text: '…' });
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    for (const raw of hunk.lines) {
      const sign = raw[0];
      const text = raw.slice(1);
      if (sign === '\\') continue; // "\ No newline at end of file"
      if (sign === '+') out.push({ kind: 'add', text, line: newLine++ });
      else if (sign === '-') out.push({ kind: 'del', text, line: oldLine++ });
      else {
        out.push({ kind: 'ctx', text, line: newLine });
        oldLine++;
        newLine++;
      }
    }
  });
  return out;
}
