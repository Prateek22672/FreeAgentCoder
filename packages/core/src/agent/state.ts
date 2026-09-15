import type { Checkpointer, FileTracker } from '../tools/types';
import type { Workspace } from '../workspace/types';

/** Remembers when the agent last read each file (read-before-write guard). */
export class FileReadTracker implements FileTracker {
  private reads = new Map<string, number>();

  markRead(absPath: string, mtimeMs: number): void {
    this.reads.set(absPath, mtimeMs);
  }

  readMtime(absPath: string): number | undefined {
    return this.reads.get(absPath);
  }

  clear(): void {
    this.reads.clear();
  }
}

export interface UndoResult {
  restored: string[];
  deleted: string[];
}

/**
 * Snapshots each file before its first change in a turn, so /undo can put
 * the project back exactly as it was before the agent's last turn. (Commands
 * the agent ran can't be undone, only file edits.)
 */
export class CheckpointStore implements Checkpointer {
  private stack: Map<string, string | null>[] = [];
  private current: Map<string, string | null> | null = null;

  beginTurn(): void {
    this.current = new Map();
  }

  record(absPath: string, before: string | null): void {
    if (!this.current) this.beginTurn();
    const turn = this.current!;
    if (turn.has(absPath)) return;
    turn.set(absPath, before);
    if (this.stack[this.stack.length - 1] !== turn) this.stack.push(turn);
  }

  get canUndo(): boolean {
    return this.stack.length > 0;
  }

  async undo(ws: Workspace): Promise<UndoResult | null> {
    const turn = this.stack.pop();
    if (!turn) return null;
    if (this.current === turn) this.current = null;
    const result: UndoResult = { restored: [], deleted: [] };
    for (const [path, before] of turn) {
      if (before === null) {
        await ws.deleteFile(path);
        result.deleted.push(path);
      } else {
        await ws.writeFile(path, before);
        result.restored.push(path);
      }
    }
    return result;
  }
}
