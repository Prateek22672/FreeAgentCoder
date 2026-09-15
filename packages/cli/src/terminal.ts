import * as readline from 'node:readline';
import { c, line } from './ui';

const stdin = process.stdin;
const stdout = process.stdout;

/**
 * Keyboard input. Readline is only open while we're actually asking for
 * something; while the agent works, stdin sits in raw mode so Ctrl+C / Esc
 * can interrupt it without the user's keystrokes spilling into the output.
 */
export class Terminal {
  readonly interactive = !!stdin.isTTY;
  private history: string[] = [];
  private rawListener: ((data: Buffer) => void) | null = null;
  private lastCtrlC = 0;

  /** Read a (possibly multi-line) message. Returns null to exit, '' after a cancelled line. */
  prompt(label: string): Promise<string | null> {
    return this.withLineInput(
      () =>
        new Promise((resolve) => {
          const rl = readline.createInterface({
            input: stdin,
            output: stdout,
            terminal: this.interactive,
            history: this.history,
            historySize: 300,
            removeHistoryDuplicates: true,
          });
          const lines: string[] = [];
          let timer: ReturnType<typeof setTimeout> | undefined;
          let done = false;
          const finish = (value: string | null) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            this.history = [...((rl as unknown as { history?: string[] }).history ?? this.history)];
            rl.close();
            resolve(value);
          };
          rl.setPrompt(label);
          rl.on('line', (input) => {
            this.lastCtrlC = 0;
            if (input.endsWith('\\')) {
              lines.push(input.slice(0, -1));
              rl.setPrompt(c.dim('… '));
              rl.prompt();
              return;
            }
            lines.push(input);
            // Pasted text arrives as a burst of lines: wait a moment for the rest.
            clearTimeout(timer);
            timer = setTimeout(() => finish(lines.join('\n')), 30);
          });
          rl.on('SIGINT', () => {
            if (rl.line || lines.length) {
              stdout.write('\n');
              finish('');
              return;
            }
            const now = Date.now();
            if (now - this.lastCtrlC < 2000) {
              stdout.write('\n');
              finish(null);
              return;
            }
            this.lastCtrlC = now;
            stdout.write(`\n${c.dim('(press Ctrl+C again to exit)')}\n`);
            rl.prompt();
          });
          rl.on('close', () => finish(lines.length ? lines.join('\n') : null));
          rl.prompt();
        }),
    );
  }

  /** A single-line question (approvals, setup). Returns null if cancelled. */
  ask(question: string): Promise<string | null> {
    return this.withLineInput(
      () =>
        new Promise((resolve) => {
          const rl = readline.createInterface({ input: stdin, output: stdout, terminal: this.interactive });
          let done = false;
          const finish = (value: string | null) => {
            if (done) return;
            done = true;
            rl.close();
            resolve(value);
          };
          rl.on('SIGINT', () => {
            stdout.write('\n');
            finish(null);
          });
          rl.on('close', () => finish(null));
          rl.question(question, (answer) => finish(answer));
        }),
    );
  }

  /** Read a secret (API key) without echoing it. */
  askSecret(question: string): Promise<string | null> {
    if (!this.interactive) return this.ask(question);
    return this.withLineInput(
      () =>
        new Promise((resolve) => {
          stdout.write(question);
          let value = '';
          stdin.setRawMode(true);
          stdin.resume();
          const onData = (data: Buffer) => {
            for (const ch of data.toString('utf8')) {
              if (ch === '\r' || ch === '\n') {
                cleanup();
                stdout.write('\n');
                resolve(value.trim());
                return;
              }
              if (ch === '') {
                cleanup();
                stdout.write('\n');
                resolve(null);
                return;
              }
              if (ch === '' || ch === '\b') {
                if (value) {
                  value = value.slice(0, -1);
                  stdout.write('\b \b');
                }
              } else if (ch >= ' ') {
                value += ch;
                stdout.write('•');
              }
            }
          };
          const cleanup = () => {
            stdin.off('data', onData);
            stdin.setRawMode(false);
            stdin.pause();
          };
          stdin.on('data', onData);
        }),
    );
  }

  /** While the agent works: call `onInterrupt` on Ctrl+C or Esc. Returns a function that stops watching. */
  watchInterrupt(onInterrupt: () => void): () => void {
    if (!this.interactive) {
      const handler = () => onInterrupt();
      process.on('SIGINT', handler);
      return () => process.off('SIGINT', handler);
    }
    const listener = (data: Buffer) => {
      const s = data.toString('utf8');
      if (s.includes('') || s === '') onInterrupt();
    };
    this.attachRaw(listener);
    return () => {
      if (this.rawListener === listener) this.detachRaw();
    };
  }

  private attachRaw(listener: (data: Buffer) => void): void {
    this.detachRaw();
    this.rawListener = listener;
    stdin.setRawMode(true);
    stdin.on('data', listener);
    stdin.resume();
  }

  private detachRaw(): void {
    if (!this.rawListener) return;
    stdin.off('data', this.rawListener);
    this.rawListener = null;
    stdin.setRawMode(false);
    stdin.pause();
  }

  /** Suspend the raw-mode interrupt watcher while readline is in charge. */
  private async withLineInput<T>(fn: () => Promise<T>): Promise<T> {
    const suspended = this.rawListener;
    if (suspended) this.detachRaw();
    try {
      return await fn();
    } finally {
      if (suspended) this.attachRaw(suspended);
    }
  }

  close(): void {
    this.detachRaw();
  }
}

export function hint(text: string): void {
  line(c.dim(text));
}
