/** Tiny terminal styling kit (no dependencies). Honors NO_COLOR and non-TTY output. */

export const colorEnabled =
  !!process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';

function wrap(open: number, close: number) {
  return (s: string) => (colorEnabled ? `\x1b[${open}m${s}\x1b[${close}m` : s);
}

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  italic: wrap(3, 23),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
};

export const ansi = {
  bold: colorEnabled ? '\x1b[1m' : '',
  unbold: colorEnabled ? '\x1b[22m' : '',
  code: colorEnabled ? '\x1b[36m' : '',
  uncode: colorEnabled ? '\x1b[39m' : '',
  heading: colorEnabled ? '\x1b[1;35m' : '',
  reset: colorEnabled ? '\x1b[0m' : '',
};

export function out(text: string): void {
  process.stdout.write(text);
}

export function line(text = ''): void {
  process.stdout.write(`${text}\n`);
}

export function width(): number {
  return Math.max(40, process.stdout.columns || 100);
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function visibleLength(text: string): number {
  return text.replace(ANSI_RE, '').length;
}

/** Cut plain text to fit on one terminal line. */
export function fit(text: string, max = width() - 2): string {
  const flat = text.replace(/\s*\n\s*/g, ' ⏎ ');
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 100_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

export function formatDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** One-line animated status. Always stop() it before printing anything else. */
export class Spinner {
  private timer: ReturnType<typeof setInterval> | undefined;
  private frame = 0;
  private startedAt = 0;
  private label = '';
  active = false;

  start(label: string): void {
    this.label = label;
    if (!process.stdout.isTTY) return;
    if (this.active) return;
    this.active = true;
    this.startedAt = Date.now();
    this.render();
    this.timer = setInterval(() => this.render(), 90);
  }

  update(label: string): void {
    this.label = label;
  }

  private render(): void {
    const secs = Math.floor((Date.now() - this.startedAt) / 1000);
    const suffix = secs >= 2 ? ` ${secs}s` : '';
    const label = fit(this.label, width() - suffix.length - 6);
    process.stdout.write(`\r\x1b[2K${c.cyan(FRAMES[this.frame++ % FRAMES.length]!)} ${c.dim(label + suffix)}`);
  }

  stop(): void {
    if (!this.active) return;
    clearInterval(this.timer);
    this.active = false;
    process.stdout.write('\r\x1b[2K');
  }
}
