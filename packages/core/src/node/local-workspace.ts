import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import type { DirEntry, FileStat, Workspace } from '../workspace/types';

/** A project folder on the local disk. */
export class LocalWorkspace implements Workspace {
  readonly root: string;
  readonly caseInsensitive = process.platform === 'win32' || process.platform === 'darwin';

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  resolve(input: string): string {
    let p = input.trim().replace(/^["']|["']$/g, '');
    if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = path.join(homedir(), p.slice(1));
    if (process.platform === 'win32') {
      // Git Bash style: /c/Users/me → C:\Users\me
      const drive = /^\/([a-zA-Z])(\/.*)?$/.exec(p);
      if (drive) p = `${drive[1]!.toUpperCase()}:${(drive[2] ?? '/').replace(/\//g, '\\')}`;
      // "/src/app.ts" has no drive: models mean "relative to the project".
      else if (/^[/\\](?![/\\])/.test(p)) p = p.slice(1);
    }
    return path.resolve(this.root, p);
  }

  relative(absPath: string): string {
    const rel = path.relative(this.root, absPath);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return absPath.split(path.sep).join('/');
    return rel.split(path.sep).join('/');
  }

  isInside(absPath: string): boolean {
    const rel = path.relative(this.root, absPath);
    return rel === '' || (!(rel === '..' || rel.startsWith(`..${path.sep}`)) && !path.isAbsolute(rel));
  }

  join(dir: string, name: string): string {
    return path.join(dir, name);
  }

  dirname(absPath: string): string {
    return path.dirname(absPath);
  }

  async stat(absPath: string): Promise<FileStat | null> {
    try {
      const st = await fs.stat(absPath);
      return { type: st.isDirectory() ? 'dir' : 'file', size: st.size, mtimeMs: st.mtimeMs };
    } catch {
      return null;
    }
  }

  readFile(absPath: string): Promise<string> {
    return fs.readFile(absPath, 'utf8');
  }

  async writeFile(absPath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, content, 'utf8');
  }

  async deleteFile(absPath: string): Promise<void> {
    await fs.rm(absPath, { force: true });
  }

  async listDir(absPath: string): Promise<DirEntry[]> {
    const entries = await fs.readdir(absPath, { withFileTypes: true });
    const out: DirEntry[] = [];
    for (const e of entries) {
      if (e.isDirectory()) out.push({ name: e.name, type: 'dir' });
      else if (e.isFile()) out.push({ name: e.name, type: 'file' });
      else if (e.isSymbolicLink()) {
        try {
          const st = await fs.stat(path.join(absPath, e.name));
          out.push({ name: e.name, type: st.isDirectory() ? 'dir' : 'file', symlink: true });
        } catch {
          // dangling link
        }
      }
    }
    return out;
  }
}
