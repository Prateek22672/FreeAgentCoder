import type { Message, Todo } from '@agentic/core';

/**
 * IndexedDB (via a 60-line wrapper) for the things that outgrow localStorage:
 * projects (all their files + chat) and the run log the Admin panel reads.
 */

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  files: Record<string, string>;
  messages: Message[];
  todos: Todo[];
}

export interface ToolStep {
  name: string;
  label: string;
  ok: boolean;
  ms: number;
  summary?: string;
  error?: string;
  denied?: boolean;
}

export interface CallLog {
  ref: string;
  ok: boolean;
  errorKind?: string;
  error?: string;
  ms: number;
  inputTokens?: number;
  outputTokens?: number;
  at: number;
}

export interface RunRecord {
  id: string;
  projectId: string;
  projectName: string;
  prompt: string;
  startedAt: number;
  ms: number;
  reason: 'completed' | 'max_steps' | 'aborted' | 'error' | 'running';
  steps: number;
  models: string[];
  inputTokens: number;
  outputTokens: number;
  tools: ToolStep[];
  calls: CallLog[];
  notices: string[];
  error?: string;
  reply: string;
  compactions: number;
}

const DB_NAME = 'agentic';
const VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      if (!db.objectStoreNames.contains('runs')) db.createObjectStore('runs', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function request<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const db = {
  putProject: (p: ProjectRecord) => request('projects', 'readwrite', (s) => s.put(p)),
  getProject: (id: string) => request<ProjectRecord | undefined>('projects', 'readonly', (s) => s.get(id)),
  listProjects: () => request<ProjectRecord[]>('projects', 'readonly', (s) => s.getAll()).then((all) => all.sort((a, b) => b.updatedAt - a.updatedAt)),
  deleteProject: (id: string) => request('projects', 'readwrite', (s) => s.delete(id)),
  putRun: (r: RunRecord) => request('runs', 'readwrite', (s) => s.put(r)),
  listRuns: () => request<RunRecord[]>('runs', 'readonly', (s) => s.getAll()).then((all) => all.sort((a, b) => b.startedAt - a.startedAt)),
  clearRuns: () => request('runs', 'readwrite', (s) => s.clear()),
};

const runListeners = new Set<() => void>();
export function onRunsChanged(fn: () => void): () => void {
  runListeners.add(fn);
  return () => runListeners.delete(fn);
}
export function notifyRunsChanged(): void {
  for (const fn of runListeners) fn();
}
