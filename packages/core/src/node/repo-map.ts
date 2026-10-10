import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileOutline } from '../tools/read';

/**
 * A map of an existing project for the first step of a complex task: the
 * files that matter most (the ones the rest import, and the entry points),
 * each with its top-level definitions, within a fixed budget. With it the
 * agent opens the right files first instead of exploring step by resent step.
 * The idea is Aider's repository map; ranking here is by how often a file is
 * imported, which works for every language without a parser.
 */

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage', '.venv', 'venv', 'env', '__pycache__', '.mypy_cache', '.pytest_cache',
  'bin', 'obj', 'target', '.gradle', '.idea', '.vscode', 'vendor', 'Pods', '.dart_tool', '.turbo', '.cache', 'tmp', 'temp', 'wwwroot',
]);
const CODE = /\.(?:[cm]?[jt]sx?|py|cs|java|kt|go|rs|rb|php|swift|dart|vue|svelte|c|cc|cpp|h|hpp|scala|razor|cshtml)$/i;
const ENTRY = /(?:^|\/)(?:main|index|app|program|server|startup|manage|wsgi|asgi|routes?|urls)\.(?:[cm]?[jt]sx?|py|cs|java|kt|go|rs|rb|php|dart)$/i;
/** Views and templates: there are many and they matter less than the code that drives them. */
const VIEW = /\.(?:cshtml|razor|vue|svelte|html)$/i;
const TEST = /(?:^|\/)(?:tests?|__tests__|spec)\/|[._-](?:test|spec)\.\w+$/i;
const MAX_FILES = 600;
const MAX_BYTES = 200_000;
const DEFS_PER_FILE = 8;

export interface MapFile {
  path: string;
  text: string;
}

async function collect(root: string): Promise<MapFile[]> {
  const files: MapFile[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (files.length >= MAX_FILES || depth > 8) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(full, depth + 1);
      } else if (entry.isFile() && CODE.test(entry.name)) {
        try {
          const stat = await fs.stat(full);
          if (stat.size > MAX_BYTES) continue;
          files.push({ path: path.relative(root, full).replace(/\\/g, '/'), text: await fs.readFile(full, 'utf8') });
        } catch {
          // Unreadable: leave it out.
        }
      }
    }
  };
  await walk(root, 0);
  return files;
}

/** The names a file pulls in: the last part of each import, require, from, using or include. */
export function importedNames(text: string): string[] {
  const names: string[] = [];
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /^\s*from\s+([\w.]+)\s+import\b/gm,
    /^\s*import\s+([\w.]+)(?:\s+as\s+\w+)?\s*$/gm,
    /^\s*using\s+(?:static\s+)?([\w.]+)\s*;/gm,
    /^\s*#include\s+"([^"]+)"/gm,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const last = m[1]!.split(/[/.]/).filter(Boolean).pop();
      if (last) names.push(last.toLowerCase());
    }
  }
  return names;
}

function stem(file: string): string {
  return path.posix.basename(file).replace(/\.[^.]+$/, '').toLowerCase();
}

/** Capitalised identifiers a file mentions: how C#, Java and Kotlin files use each other's classes. */
function classNames(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b[A-Z][A-Za-z0-9_]{3,}\b/g)) out.add(m[0]);
  return out;
}

/** A file named after its class (CrmService.cs), so a mention of the name is a use of the file. */
function className(file: string): string | undefined {
  const base = path.posix.basename(file).replace(/\.[^.]+$/, '');
  return /^[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*$/.test(base) ? base : undefined;
}

const TYPE_DECL = /^\s*(?:(?:public|internal|private|protected|sealed|static|abstract|partial|final|open|data)\s+)*(?:class|record|interface|enum|struct|object)\s+\w+/;

/** Top-level definitions, in file order: the shared outline, plus class-like declarations it misses. */
function definitions(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const found = new Map<number, string>();
  for (const entry of fileOutline(lines).split('\n')) {
    const at = /^(\d+):\s*(.*)$/.exec(entry);
    if (at) found.set(Number(at[1]), at[2]!);
  }
  lines.forEach((line, i) => {
    if (TYPE_DECL.test(line) && line.length < 200) found.set(i + 1, line.trim());
  });
  return [...found.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, d]) => d)
    .filter((d) => !/^(?:const|let|namespace|package|import|using|module)\b|^@/.test(d));
}

/** A definition as a short name: "function cn(...)", "class CrmService", "type Tier". */
export function shortDef(line: string): string {
  const clean = line.replace(/^\d+:\s*/, '').replace(/^export\s+(default\s+)?/, '').replace(/\s+/g, ' ');
  const head = clean.split(/\s*=\s*|\s*\{/)[0]!;
  return head.length > 60 ? `${head.slice(0, 57)}…` : head;
}

/** Ranked files with their definitions, as text no longer than `budget` characters. */
export function formatRepoMap(files: MapFile[], budget = 6_000): string {
  if (files.length < 4) return '';
  // Who uses each file: an import of its name, or (for languages that import namespaces) a mention of its class.
  const imports = new Map<string, Set<number>>();
  const mentions = files.map((f) => classNames(f.text));
  files.forEach((file, i) => {
    for (const name of new Set(importedNames(file.text))) {
      const users = imports.get(name) ?? new Set<number>();
      users.add(i);
      imports.set(name, users);
    }
  });
  const ranked = files
    .map((f, i) => {
      const name = stem(f.path);
      const users = new Set(imports.get(name) ?? []);
      const cls = VIEW.test(f.path) ? undefined : className(f.path);
      if (cls) mentions.forEach((m, j) => j !== i && m.has(cls) && users.add(j));
      users.delete(i);
      const used = users.size;
      const score = used * 3 + (ENTRY.test(f.path) ? 4 : 0) - (TEST.test(f.path) ? 6 : 0) - (VIEW.test(f.path) ? 4 : 0) - f.path.split('/').length * 0.1;
      return { f, used, score };
    })
    .sort((a, b) => b.score - a.score);

  const lines: string[] = [];
  let used = 0;
  let shown = 0;
  for (const { f, used: count } of ranked) {
    const defs = VIEW.test(f.path) ? [] : definitions(f.text).slice(0, DEFS_PER_FILE).map(shortDef);
    const block = [`${f.path}${count ? ` (used by ${count})` : ''}`, ...(defs.length ? [`  ${defs.join(' | ')}`] : [])].join('\n');
    if (used + block.length + 1 > budget) break;
    lines.push(block);
    used += block.length + 1;
    shown++;
  }
  const rest = files.length - shown;
  return lines.length ? `${lines.join('\n')}${rest > 0 ? `\n… and ${rest} more code file${rest === 1 ? '' : 's'} (find them with glob or search_code)` : ''}` : '';
}

export async function repoMap(root: string, budget = 6_000): Promise<string> {
  return formatRepoMap(await collect(root), budget);
}
