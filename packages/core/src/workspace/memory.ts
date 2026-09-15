import * as posix from './posix';
import type { DirEntry, FileStat, Workspace } from './types';

export interface WorkspaceChange {
  type: 'write' | 'delete' | 'reset';
  path: string;
}

/**
 * A whole project held in memory. Used by the web builder (the live preview
 * reads straight from it) and by tests. Paths are POSIX and rooted at "/";
 * directories exist implicitly as long as a file lives under them.
 */
export class MemoryWorkspace implements Workspace {
  readonly root = '/';
  private files = new Map<string, { content: string; mtimeMs: number }>();
  private listeners = new Set<(change: WorkspaceChange) => void>();
  private clock = 0;

  constructor(initial: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(initial)) {
      this.files.set(posix.normalize(path), { content, mtimeMs: this.tick() });
    }
  }

  private tick(): number {
    this.clock = Math.max(this.clock + 1, Date.now());
    return this.clock;
  }

  private emit(change: WorkspaceChange): void {
    for (const fn of this.listeners) fn(change);
  }

  resolve(path: string): string {
    return posix.normalize(path.startsWith('/') ? path : `/${path}`);
  }

  relative(absPath: string): string {
    return posix.normalize(absPath).slice(1);
  }

  isInside(): boolean {
    return true;
  }

  join(dir: string, name: string): string {
    return posix.join(dir, name);
  }

  dirname(absPath: string): string {
    return posix.dirname(absPath);
  }

  private isDir(path: string): boolean {
    const prefix = path === '/' ? '/' : `${path}/`;
    for (const key of this.files.keys()) if (key.startsWith(prefix)) return true;
    return false;
  }

  async stat(absPath: string): Promise<FileStat | null> {
    const path = posix.normalize(absPath);
    const file = this.files.get(path);
    if (file) return { type: 'file', size: file.content.length, mtimeMs: file.mtimeMs };
    if (path === '/' || this.isDir(path)) return { type: 'dir', size: 0, mtimeMs: 0 };
    return null;
  }

  async readFile(absPath: string): Promise<string> {
    const file = this.files.get(posix.normalize(absPath));
    if (!file) throw new Error(`ENOENT: no such file ${absPath}`);
    return file.content;
  }

  async writeFile(absPath: string, content: string): Promise<void> {
    const path = posix.normalize(absPath);
    this.files.set(path, { content, mtimeMs: this.tick() });
    this.emit({ type: 'write', path });
  }

  async deleteFile(absPath: string): Promise<void> {
    const path = posix.normalize(absPath);
    if (this.files.delete(path)) this.emit({ type: 'delete', path });
  }

  async listDir(absPath: string): Promise<DirEntry[]> {
    const path = posix.normalize(absPath);
    const prefix = path === '/' ? '/' : `${path}/`;
    const entries = new Map<string, 'file' | 'dir'>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash === -1) entries.set(rest, 'file');
      else entries.set(rest.slice(0, slash), 'dir');
    }
    return [...entries].map(([name, type]) => ({ name, type }));
  }

  // ---- extras for UIs ----

  /** All files as { "/src/App.tsx": "..." }. */
  snapshot(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [path, file] of this.files) out[path] = file.content;
    return out;
  }

  /** Replace every file (loading a saved project, starting a new one). */
  reset(files: Record<string, string> = {}): void {
    this.files.clear();
    for (const [path, content] of Object.entries(files)) {
      this.files.set(posix.normalize(path), { content, mtimeMs: this.tick() });
    }
    this.emit({ type: 'reset', path: '/' });
  }

  subscribe(listener: (change: WorkspaceChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
