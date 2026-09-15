import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Message, Todo, Usage } from '../types';
import { randomId } from '../util/ids';
import { configDir } from './config';

export interface SessionData {
  id: string;
  cwd: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  messages: Message[];
  todos: Todo[];
  usage: Usage;
}

function projectKey(cwd: string): string {
  const normalized = path.resolve(cwd);
  const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  return createHash('sha1').update(key).digest('hex').slice(0, 12);
}

function sessionsDir(cwd: string): string {
  return path.join(configDir(), 'sessions', projectKey(cwd));
}

export function newSessionId(): string {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  return `${stamp}-${randomId(4)}`;
}

export function sessionTitle(messages: Message[]): string {
  const first = messages.find((m) => m.role === 'user' && !m.synthetic)?.content ?? 'Untitled';
  const line = first.split('\n')[0]!.trim();
  return line.length > 70 ? `${line.slice(0, 69)}…` : line;
}

export async function saveSession(data: SessionData): Promise<void> {
  const dir = sessionsDir(data.cwd);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${data.id}.json`);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data), 'utf8');
  await fs.rename(tmp, file);
}

export async function listSessions(cwd: string): Promise<SessionData[]> {
  const dir = sessionsDir(cwd);
  let files: string[];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const sessions: SessionData[] = [];
  for (const f of files) {
    try {
      sessions.push(JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')) as SessionData);
    } catch {
      // skip corrupt files
    }
  }
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** A session by id, or the most recent one for this folder. */
export async function loadSession(cwd: string, id?: string): Promise<SessionData | null> {
  const sessions = await listSessions(cwd);
  if (!id) return sessions[0] ?? null;
  return sessions.find((s) => s.id === id || s.id.startsWith(id)) ?? null;
}
