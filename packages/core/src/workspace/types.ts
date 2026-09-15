/**
 * The one seam between the agent and "where the files live". Tools only ever
 * talk to a Workspace, so the same agent drives a real project on disk
 * (LocalWorkspace, CLI) or a virtual project in the browser (MemoryWorkspace,
 * web builder).
 */

export interface FileStat {
  type: 'file' | 'dir';
  size: number;
  mtimeMs: number;
}

export interface DirEntry {
  name: string;
  type: 'file' | 'dir';
  /** Symlinked directories are listed but never descended into (cycles). */
  symlink?: boolean;
}

export interface Workspace {
  /** Absolute project root, in this workspace's own path format. */
  readonly root: string;
  /** File names differ only by case on this file system (Windows, macOS). */
  readonly caseInsensitive?: boolean;
  /** Turn a model-supplied path (relative or absolute) into an absolute path. */
  resolve(path: string): string;
  /** Root-relative path with forward slashes ('' for the root). Paths outside the root come back absolute. */
  relative(absPath: string): string;
  isInside(absPath: string): boolean;
  join(dir: string, name: string): string;
  dirname(absPath: string): string;
  stat(absPath: string): Promise<FileStat | null>;
  readFile(absPath: string): Promise<string>;
  /** Creates parent directories as needed. */
  writeFile(absPath: string, content: string): Promise<void>;
  deleteFile(absPath: string): Promise<void>;
  listDir(absPath: string): Promise<DirEntry[]>;
}

/** How a path should be shown to the model and the user. */
export function displayPath(ws: Workspace, absPath: string): string {
  if (!ws.isInside(absPath)) return absPath;
  return ws.relative(absPath) || '.';
}
