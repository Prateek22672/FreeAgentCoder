/**
 * Whether an edit breaks a file's brackets. In a real chat a model "fixed" a
 * Dart compile error by adding and removing closing braces one edit at a time,
 * each edit leaving the file worse; a file whose (), [] and {} all match before
 * an edit should still match after it. Strings, comments and ${} interpolation
 * are skipped. The scan is not a parser: it is only trusted when the file was
 * balanced before the edit, so a construct it misreads never blocks anything.
 */

const CODE_FILE = /\.(?:dart|ts|tsx|mts|cts|js|jsx|mjs|cjs|java|kt|kts|cs|c|h|cc|cpp|hpp|swift|go|rs|php|scala|css|scss|less|json|jsonc|vue|svelte)$/i;

const OPEN: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const CLOSE: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

type Frame = { kind: 'bracket'; ch: string; line: number } | { kind: 'interp'; quote: string; triple: boolean };

/** undefined when every bracket matches, else what is wrong and where. */
export function bracketProblem(text: string): string | undefined {
  const stack: Frame[] = [];
  let line = 1;
  let i = 0;
  const n = text.length;
  // In a string: its quote, whether it is triple-quoted, raw (no escapes), and where it started.
  let str: { quote: string; triple: boolean; raw: boolean; line: number } | undefined;

  while (i < n) {
    const c = text[i]!;
    if (c === '\n') line++;
    if (str) {
      if (c === '\\' && !str.raw) {
        if (text[i + 1] === '\n') line++;
        i += 2;
        continue;
      }
      if (!str.raw && c === '$' && text[i + 1] === '{' && str.quote !== '') {
        stack.push({ kind: 'interp', quote: str.quote, triple: str.triple });
        str = undefined;
        i += 2;
        continue;
      }
      if (str.triple ? text.startsWith(str.quote.repeat(3), i) : c === str.quote) {
        i += str.triple ? 3 : 1;
        str = undefined;
        continue;
      }
      // A plain ' or " string cannot run past the end of its line: treat it as closed there.
      if (c === '\n' && !str.triple && str.quote !== '`') str = undefined;
      i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      i = end < 0 ? n : end;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      for (let k = i; k < stop; k++) if (text[k] === '\n') line++;
      i = stop;
      continue;
    }
    // A JavaScript regex literal (/[({]/): a slash where a value starts, not after one (a / b divides).
    if (c === '/' && /(?:^|[(,=:[!&|?{};]|\breturn)\s*$/.test(text.slice(Math.max(0, i - 12), i))) {
      let k = i + 1;
      let inClass = false;
      for (; k < n && text[k] !== '\n'; k++) {
        if (text[k] === '\\') k++;
        else if (text[k] === '[') inClass = true;
        else if (text[k] === ']') inClass = false;
        else if (text[k] === '/' && !inClass) break;
      }
      if (text[k] === '/') {
        i = k + 1;
        continue;
      }
    }
    if (c === '"' || c === "'" || c === '`') {
      const triple = c !== '`' && text.startsWith(c.repeat(3), i);
      const raw = text[i - 1] === 'r' && !/[\w$]/.test(text[i - 2] ?? '');
      str = { quote: c, triple, raw, line };
      i += triple ? 3 : 1;
      continue;
    }
    if (OPEN[c]) {
      stack.push({ kind: 'bracket', ch: c, line });
    } else if (CLOSE[c]) {
      const top = stack[stack.length - 1];
      if (c === '}' && top?.kind === 'interp') {
        stack.pop();
        str = { quote: top.quote, triple: top.triple, raw: false, line };
      } else if (top?.kind === 'bracket' && top.ch === CLOSE[c]) {
        stack.pop();
      } else if (top?.kind === 'bracket') {
        return `line ${line}: '${c}' closes the '${top.ch}' opened on line ${top.line}`;
      } else {
        return `line ${line}: '${c}' has nothing to close`;
      }
    }
    i++;
  }
  if (str?.triple || str?.quote === '`') return `a string opened on line ${str.line} is never closed`;
  const open = stack.reverse().find((f): f is Extract<Frame, { kind: 'bracket' }> => f.kind === 'bracket');
  return open ? `the '${open.ch}' opened on line ${open.line} is never closed` : undefined;
}

/**
 * A message refusing a change that would break the brackets of a code file
 * that is balanced now, or undefined when the change is fine (or the file is
 * not code, or was already unbalanced).
 */
export function bracketsBroken(file: string, before: string, after: string, shown = file): string | undefined {
  if (!CODE_FILE.test(file) || before.length > 2_000_000 || bracketProblem(before)) return undefined;
  const problem = bracketProblem(after);
  if (!problem) return undefined;
  return (
    `Not changed: this would break ${shown} (${problem}), and its brackets all match now. ` +
    'Read the whole function or widget around the change, then make one edit that replaces complete blocks, each opening bracket with its closing one. ' +
    'Do not add or remove single braces to quiet a compiler error: find the block the error is really in.'
  );
}
