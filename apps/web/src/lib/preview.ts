import type { Tool } from '@agentic/core';

export interface PreviewError {
  kind: 'compile' | 'runtime';
  message: string;
  path?: string;
  line?: number;
}

/**
 * Shared state between the Sandpack preview and the agent's check_preview
 * tool: is the bundle compiling, did it fail, what did the app log.
 */
export class PreviewBridge {
  status: 'idle' | 'compiling' | 'ok' | 'error' = 'idle';
  compileError: PreviewError | null = null;
  runtimeErrors: PreviewError[] = [];
  /** Set when a file changed; cleared when the bundler reports a result after it. */
  private dirty = false;
  private listeners = new Set<() => void>();

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  fileChanged(): void {
    this.dirty = true;
    this.runtimeErrors = [];
    this.emit();
  }

  compiling(): void {
    this.status = 'compiling';
    this.emit();
  }

  compiled(error: PreviewError | null): void {
    this.dirty = false;
    this.compileError = error;
    this.status = error ? 'error' : 'ok';
    this.emit();
  }

  runtimeError(err: PreviewError): void {
    if (this.runtimeErrors.some((e) => e.message === err.message)) return;
    this.runtimeErrors = [...this.runtimeErrors.slice(-9), err];
    this.status = 'error';
    this.emit();
  }

  clearRuntime(): void {
    this.runtimeErrors = [];
    if (this.status === 'error' && !this.compileError) this.status = 'ok';
    this.emit();
  }

  get errors(): PreviewError[] {
    return [...(this.compileError ? [this.compileError] : []), ...this.runtimeErrors];
  }

  /** Resolve once the bundler has processed the latest change (or after `timeoutMs`). */
  waitForSettle(timeoutMs = 8000): Promise<void> {
    if (!this.dirty && this.status !== 'compiling') return new Promise((r) => setTimeout(r, 600));
    return new Promise((resolve) => {
      const timer = setTimeout(done, timeoutMs);
      const unsub = this.subscribe(() => {
        if (!this.dirty && this.status !== 'compiling') done();
      });
      function done() {
        clearTimeout(timer);
        unsub();
        // Give runtime errors a moment to surface after the reload.
        setTimeout(resolve, 700);
      }
    });
  }
}

export function checkPreviewTool(bridge: PreviewBridge): Tool<Record<string, never>> {
  return {
    name: 'check_preview',
    description:
      'Compile the project in the live preview and report compile errors and runtime errors from the running app. Call it after making changes, and fix anything it reports.',
    parameters: { type: 'object', properties: {} },
    kind: 'meta',
    label: () => 'Check preview',
    async prepare(_args, ctx) {
      return {
        run: async () => {
          await bridge.waitForSettle();
          if (ctx.signal.aborted) return { content: 'Cancelled.', isError: true };
          const errors = bridge.errors;
          if (!errors.length) {
            return { content: 'The preview compiled and is running without errors.', summary: 'no errors' };
          }
          const lines = errors.map((e) => `- [${e.kind}] ${e.message}${e.path ? ` (${e.path}${e.line ? `:${e.line}` : ''})` : ''}`);
          return {
            content: `The preview has ${errors.length} error${errors.length === 1 ? '' : 's'}:\n${lines.join('\n')}\nFix them, then call check_preview again.`,
            isError: true,
            summary: `${errors.length} error${errors.length === 1 ? '' : 's'}`,
          };
        },
      };
    },
  };
}
