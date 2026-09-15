import { ansi, colorEnabled } from './ui';

/**
 * Styles Markdown as it streams in, character by character, so the reply
 * appears live: headings, **bold**, `inline code` and fenced code blocks.
 * Only a few characters at the start of a line are held back (to tell a
 * "```" fence or "# " heading from ordinary text).
 */
export class MarkdownStream {
  private mode: 'start' | 'text' | 'fence' | 'heading' = 'start';
  private startBuf = '';
  private inCodeBlock = false;
  private bold = false;
  private code = false;
  private pendingStar = false;
  wroteAnything = false;

  constructor(private readonly write: (s: string) => void) {}

  push(text: string): void {
    if (!colorEnabled) {
      if (text) this.wroteAnything = true;
      this.write(text);
      return;
    }
    for (const ch of text) this.char(ch);
  }

  private emit(s: string): void {
    if (s) this.wroteAnything = true;
    this.write(s);
  }

  private char(ch: string): void {
    if (this.mode === 'fence') {
      if (ch === '\n') {
        this.inCodeBlock = !this.inCodeBlock;
        this.emit(`\x1b[2m${this.startBuf}\x1b[22m`);
        this.startBuf = '';
        this.newline();
      } else {
        this.startBuf += ch;
      }
      return;
    }

    if (this.mode === 'start') {
      if (ch === '\n') {
        this.releaseStart();
        this.newline();
        return;
      }
      this.startBuf += ch;
      const s = this.startBuf;
      if (s.length < 3 && '```'.startsWith(s)) return;
      if (s.startsWith('```')) {
        this.mode = 'fence';
        return;
      }
      if (!this.inCodeBlock && /^#{1,6}$/.test(s)) return;
      if (!this.inCodeBlock && /^#{1,6} $/.test(s)) {
        this.startBuf = '';
        this.mode = 'heading';
        this.emit(ansi.heading);
        return;
      }
      this.releaseStart();
      return;
    }

    if (ch === '\n') {
      this.newline();
      return;
    }
    if (this.mode === 'heading' || this.inCodeBlock) {
      this.emit(ch);
      return;
    }
    this.inline(ch);
  }

  /** Stop holding back line-start characters and print them normally. */
  private releaseStart(): void {
    const buf = this.startBuf;
    this.startBuf = '';
    this.mode = 'text';
    if (this.inCodeBlock) {
      this.emit(ansi.code + buf);
      return;
    }
    for (const ch of buf) this.inline(ch);
  }

  private inline(ch: string): void {
    if (this.pendingStar) {
      this.pendingStar = false;
      if (ch === '*') {
        this.bold = !this.bold;
        this.emit(this.bold ? ansi.bold : ansi.unbold);
        return;
      }
      this.emit('*');
    }
    if (ch === '*') {
      this.pendingStar = true;
      return;
    }
    if (ch === '`') {
      this.code = !this.code;
      this.emit(this.code ? ansi.code : ansi.uncode);
      return;
    }
    this.emit(ch);
  }

  private newline(): void {
    if (this.pendingStar) this.emit('*');
    this.pendingStar = false;
    if (this.bold || this.code || this.mode === 'heading' || this.inCodeBlock) this.emit(ansi.reset);
    this.bold = false;
    this.code = false;
    this.mode = 'start';
    this.emit('\n');
  }

  /** End of the message: print anything held back and reset styles. */
  end(): void {
    if (!colorEnabled) return;
    if (this.mode === 'fence') {
      this.emit(`\x1b[2m${this.startBuf}\x1b[22m`);
      this.startBuf = '';
    } else if (this.mode === 'start' && this.startBuf) {
      this.releaseStart();
    }
    if (this.pendingStar) this.emit('*');
    this.emit(ansi.reset);
    this.pendingStar = false;
    this.bold = false;
    this.code = false;
    this.inCodeBlock = false;
    this.mode = 'start';
  }
}
