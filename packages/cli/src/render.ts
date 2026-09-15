import { lineDiff, type AgentEvent, type Todo, type ToolDisplay, type Usage } from '@agentic/core';
import { MarkdownStream } from './markdown';
import { c, fit, formatDuration, formatTokens, line, out, Spinner, width } from './ui';

type DiffDisplay = Extract<ToolDisplay, { type: 'diff' }>;

export function diffStats(d: DiffDisplay): string {
  const rows = lineDiff(d.before, d.after, 0);
  const adds = rows.filter((r) => r.kind === 'add').length;
  const dels = rows.filter((r) => r.kind === 'del').length;
  if (d.created) return `${c.green(`+${adds}`)} ${c.dim('new file')}`;
  return `${c.green(`+${adds}`)} ${c.red(`-${dels}`)}`;
}

/** Colored diff lines, capped for the terminal. */
export function renderDiff(d: DiffDisplay, maxLines = 24): string[] {
  const rows = lineDiff(d.before, d.after, 2);
  const shown = d.created ? rows.slice(0, Math.min(maxLines, 12)) : rows.slice(0, maxLines);
  const numWidth = String(Math.max(0, ...shown.map((r) => r.line ?? 0))).length;
  const textWidth = width() - numWidth - 10;
  const outLines = shown.map((r) => {
    const num = String(r.line ?? '').padStart(numWidth);
    const text = r.text.length > textWidth ? `${r.text.slice(0, textWidth - 1)}…` : r.text;
    if (r.kind === 'gap') return c.dim(`${' '.repeat(numWidth)}   ⋮`);
    if (r.kind === 'add') return c.green(`${num} + ${text}`);
    if (r.kind === 'del') return c.red(`${num} - ${text}`);
    return c.dim(`${num}   ${text}`);
  });
  if (rows.length > shown.length) outLines.push(c.dim(`… ${rows.length - shown.length} more lines`));
  return outLines;
}

export function renderTodos(todos: Todo[]): string[] {
  return todos.map((t) => {
    if (t.status === 'completed') return c.dim(`✓ ${t.content}`);
    if (t.status === 'in_progress') return c.yellow(`▸ ${c.bold(t.content)}`);
    return `○ ${t.content}`;
  });
}

function tail(text: string, n: number): string[] {
  const lines = text.split('\n').filter((l) => l.trim());
  return lines.slice(-n);
}

export interface RenderOptions {
  verbose?: boolean;
}

/** Turns agent events into terminal output for one turn. */
export class TurnRenderer {
  readonly spinner = new Spinner();
  private md: MarkdownStream | null = null;
  private lastModel: string | undefined;
  private lastBlock: 'none' | 'text' | 'tool' = 'none';
  private readonly startedAt = Date.now();
  private turnUsage: Usage = { inputTokens: 0, outputTokens: 0 };
  private steps = 0;
  private reasoningShown = false;

  constructor(
    private readonly opts: RenderOptions = {},
    initialModel?: string,
  ) {
    this.lastModel = initialModel;
  }

  private endText(): void {
    if (!this.md) return;
    this.md.end();
    if (this.md.wroteAnything) out('\n');
    this.md = null;
    this.lastBlock = 'text';
  }

  private toolLine(text: string): void {
    this.spinner.stop();
    this.endText();
    if (this.lastBlock === 'text') line();
    line(text);
    this.lastBlock = 'tool';
  }

  handle(ev: AgentEvent): void {
    switch (ev.type) {
      case 'model':
        this.steps = ev.step;
        if (this.lastModel && ev.ref !== this.lastModel) this.toolLine(c.dim(`  ↪ now using ${ev.ref}`));
        this.lastModel = ev.ref;
        this.reasoningShown = false;
        this.spinner.start('Thinking');
        break;
      case 'reasoning':
        if (this.opts.verbose) {
          this.spinner.stop();
          if (!this.reasoningShown) {
            line(c.dim(c.italic('  thinking…')));
            this.reasoningShown = true;
          }
          out(c.dim(ev.delta));
        } else {
          this.spinner.start('Thinking');
        }
        break;
      case 'text':
        this.spinner.stop();
        if (!this.md) {
          if (this.lastBlock !== 'none') out('\n');
          this.md = new MarkdownStream(out);
        }
        this.md.push(ev.delta);
        break;
      case 'tool_call_streaming':
        this.endText();
        this.spinner.start(`Preparing ${ev.name}…`);
        break;
      case 'reset':
        this.endText();
        this.toolLine(c.dim('  (that attempt failed; retrying)'));
        break;
      case 'assistant':
        this.endText();
        break;
      case 'tool_start':
        this.toolLine(`${c.cyan('●')} ${c.bold(fit(ev.label, width() - 4))}`);
        this.spinner.start(ev.call.name === 'run_command' ? 'Running…' : 'Working…');
        break;
      case 'approval':
        this.spinner.stop();
        break;
      case 'tool_output': {
        const last = tail(ev.chunk, 1)[0];
        if (last) this.spinner.update(`Running · ${last.trim()}`);
        break;
      }
      case 'tool_end':
        this.spinner.stop();
        this.renderResult(ev);
        break;
      case 'todos':
        break;
      case 'notice':
        this.toolLine(c.yellow(`  ! ${ev.message}`));
        break;
      case 'compacted':
        this.toolLine(c.dim(`  ⟲ context ${ev.kind === 'micro' ? 'trimmed' : 'summarized'}: ${formatTokens(ev.before)} → ${formatTokens(ev.after)} tokens`));
        break;
      case 'usage':
        this.turnUsage = {
          inputTokens: this.turnUsage.inputTokens + ev.usage.inputTokens,
          outputTokens: this.turnUsage.outputTokens + ev.usage.outputTokens,
        };
        break;
      case 'error':
        this.toolLine(c.red(`✗ ${ev.message}`));
        break;
      case 'done':
        this.spinner.stop();
        this.endText();
        this.footer(ev.reason);
        break;
    }
  }

  private renderResult(ev: Extract<AgentEvent, { type: 'tool_end' }>): void {
    const { result } = ev;
    const bar = c.dim('  ⎿ ');
    if (ev.denied) {
      line(bar + (result.summary === 'declined' ? c.yellow('declined') : c.red(fit(result.content, width() - 6))));
      return;
    }
    const d = result.display;
    if (d?.type === 'diff') {
      line(bar + diffStats(d));
      for (const l of renderDiff(d)) line(`    ${l}`);
    } else if (d?.type === 'command') {
      for (const l of tail(d.output, d.exitCode === 0 ? 4 : 10)) line(c.dim(`  │ ${fit(l, width() - 6)}`));
      const summary = result.summary ?? '';
      line(bar + (result.isError ? c.red(summary) : c.green(summary)));
    } else if (d?.type === 'todos') {
      for (const l of renderTodos(d.todos)) line(`    ${l}`);
    } else if (result.isError) {
      line(bar + c.red(fit(result.content, width() - 6)));
    } else {
      line(bar + c.dim(result.summary ?? fit(result.content, width() - 6)));
    }
    this.lastBlock = 'tool';
  }

  private footer(reason: 'completed' | 'max_steps' | 'aborted' | 'error'): void {
    const parts = [
      `${this.steps} step${this.steps === 1 ? '' : 's'}`,
      formatDuration(Date.now() - this.startedAt),
    ];
    if (this.turnUsage.inputTokens) parts.push(`${formatTokens(this.turnUsage.inputTokens)}↑ ${formatTokens(this.turnUsage.outputTokens)}↓`);
    if (this.lastModel) parts.push(this.lastModel);
    line();
    if (reason === 'max_steps') line(c.yellow(`⏸ Paused after ${this.steps} steps. Type "continue" to keep going.`));
    else if (reason === 'aborted') line(c.yellow('⏹ Interrupted. Tell me what to do instead, or type "continue".'));
    line(c.dim(`  ${parts.join(' · ')}`));
  }
}
