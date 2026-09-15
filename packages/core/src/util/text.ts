/** Rough token estimate. Code tokenizes denser than prose, hence 3.5 not 4. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/** Keep the start and (larger) end of a long text; errors and summaries live at the end. */
export function truncateMiddle(text: string, maxChars: number, headRatio = 0.25): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * headRatio);
  const tail = maxChars - head;
  const omitted = text.length - head - tail;
  return `${text.slice(0, head)}\n\n… [${omitted} characters omitted] …\n\n${text.slice(text.length - tail)}`;
}

// Same pattern as the `ansi-regex` package (CSI + OSC sequences).
const ANSI = new RegExp(
  [
    '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
    '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))',
  ].join('|'),
  'g',
);

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/**
 * Terminal progress bars redraw a line with `\r`. Keep only what the last
 * redraw left visible, so `npm install` output doesn't cost thousands of tokens.
 */
export function collapseCarriageReturns(text: string): string {
  if (!text.includes('\r')) return text;
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
      const idx = trimmed.lastIndexOf('\r');
      return idx === -1 ? trimmed : trimmed.slice(idx + 1);
    })
    .join('\n');
}

/**
 * Open-weight models served through chat APIs occasionally leak their chat
 * template's control tokens (gpt-oss "harmony" markers, `<|im_end|>`, ...).
 */
export function cleanModelText(text: string): string {
  if (!text) return text;
  return text
    .replace(/<\|[a-z_]+\|>/gi, '')
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .trim();
}

export function countLines(text: string): number {
  if (!text) return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}
