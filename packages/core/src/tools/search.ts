import type { FileStat, Workspace } from '../workspace/types';
import { isNoisyFile, looksBinary, walkFiles } from '../workspace/walk';
import type { Tool } from './types';

/**
 * A local search index over the project's source files: BM25 ranking over
 * identifiers split into words (getUserProfile → user, profile) and path
 * names. It answers "which files are about X?" instantly and without any
 * model or API calls, so it costs no quota.
 */

const INDEXABLE =
  /\.(?:[cm]?[jt]sx?|py|dart|go|rs|java|kts?|swift|rb|php|cs|c|cc|cpp|h|hpp|m|mm|scala|lua|r|jl|sh|bash|ps1|sql|graphql|gql|proto|vue|svelte|astro|html?|css|scss|less|json|ya?ml|toml|ini|md|mdx|txt|gradle|xml|tf)$/i;
const INDEXABLE_NAMES = new Set(['Dockerfile', 'Makefile', 'Procfile', 'Gemfile', 'Rakefile']);

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'are', 'was', 'you', 'your', 'not', 'but', 'all', 'can', 'use', 'has',
  'have', 'will', 'what', 'when', 'how', 'why', 'where', 'which', 'there', 'their', 'then', 'than', 'them', 'they', 'its', 'our', 'out',
  'get', 'set', 'new', 'let', 'var', 'const', 'function', 'return', 'import', 'export', 'class', 'public', 'private', 'protected',
  'static', 'void', 'true', 'false', 'null', 'none', 'undefined', 'self', 'def', 'async', 'await', 'type', 'interface', 'string',
  'number', 'int', 'str', 'bool', 'boolean', 'any', 'else', 'elif', 'while', 'break', 'case', 'default', 'try', 'catch', 'except',
  'finally', 'please', 'make', 'add', 'file', 'files', 'code', 'app', 'fix', 'change', 'update', 'create',
]);

export interface SearchHit {
  path: string;
  /** Line range of the best-matching section. */
  start: number;
  end: number;
  score: number;
  matched: string[];
}

interface Chunk {
  file: string;
  start: number;
  end: number;
  length: number;
  tf: Map<string, number>;
}

interface Entry {
  rel: string;
  mtimeMs: number;
  size: number;
  chunks: number[];
}

function stem(word: string): string {
  return word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

/** Words for indexing: identifiers split on case and underscores, lowercased, without noise words. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const word of text.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []) {
    const parts = word
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .toLowerCase()
      .split(' ');
    for (const part of parts) {
      if (part.length > 2 && !STOP_WORDS.has(part)) out.push(stem(part));
    }
  }
  return out;
}

export interface CodeIndexOptions {
  maxFiles?: number;
  maxFileBytes?: number;
  chunkLines?: number;
  /** A refresh is skipped if the last one finished less than this long ago. */
  staleMs?: number;
}

export class CodeIndex {
  private readonly entries = new Map<string, Entry>();
  private chunks: (Chunk | undefined)[] = [];
  private readonly df = new Map<string, number>();
  private totalLength = 0;
  private chunkCount = 0;
  private refreshedAt = 0;
  private refreshing?: Promise<void>;

  constructor(
    private readonly ws: Workspace,
    private readonly opts: CodeIndexOptions = {},
  ) {}

  get fileCount(): number {
    return this.entries.size;
  }

  async ensureFresh(signal?: AbortSignal): Promise<void> {
    if (Date.now() - this.refreshedAt >= (this.opts.staleMs ?? 15_000)) await this.refresh(signal);
  }

  /** Re-reads only files whose size or modification time changed. */
  refresh(signal?: AbortSignal): Promise<void> {
    this.refreshing ??= this.rebuild(signal).finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  search(query: string, limit = 8): SearchHit[] {
    const terms = [...new Set(tokenize(query))];
    if (!terms.length || !this.chunkCount) return [];
    const averageLength = this.totalLength / this.chunkCount;
    const idf = new Map(
      terms.map((term) => {
        const df = this.df.get(term) ?? 0;
        return [term, Math.log(1 + (this.chunkCount - df + 0.5) / (df + 0.5))] as const;
      }),
    );

    const files = new Map<string, { best: Chunk; bestScore: number; total: number; matched: Set<string> }>();
    for (const chunk of this.chunks) {
      if (!chunk) continue;
      let score = 0;
      const matched: string[] = [];
      for (const term of terms) {
        const frequency = chunk.tf.get(term);
        if (!frequency) continue;
        matched.push(term);
        score += (idf.get(term) ?? 0) * ((frequency * 2.2) / (frequency + 1.2 * (0.25 + 0.75 * (chunk.length / averageLength))));
      }
      if (!score) continue;
      const hit = files.get(chunk.file);
      if (!hit) {
        files.set(chunk.file, { best: chunk, bestScore: score, total: score, matched: new Set(matched) });
        continue;
      }
      hit.total += score;
      if (score > hit.bestScore) {
        hit.best = chunk;
        hit.bestScore = score;
      }
      for (const term of matched) hit.matched.add(term);
    }

    return [...files.entries()]
      .map(([abs, hit]) => ({
        path: this.entries.get(abs)?.rel ?? abs,
        start: hit.best.start,
        end: hit.best.end,
        score: (hit.bestScore + 0.25 * (hit.total - hit.bestScore)) * (0.5 + (0.5 * hit.matched.size) / terms.length),
        matched: [...hit.matched],
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** A few lines of the hit's best section that contain matched words. */
  async snippet(hit: SearchHit, maxLines = 4): Promise<string> {
    let text: string;
    try {
      text = await this.ws.readFile(this.ws.resolve(hit.path));
    } catch {
      return '';
    }
    const shown: string[] = [];
    text
      .split(/\r?\n/)
      .slice(hit.start - 1, hit.end)
      .forEach((line, offset) => {
        const lower = line.toLowerCase();
        if (shown.length < maxLines && line.trim() && hit.matched.some((term) => lower.includes(term))) {
          shown.push(`   ${hit.start + offset}\t${line.trim().slice(0, 160)}`);
        }
      });
    return shown.join('\n');
  }

  private async rebuild(signal?: AbortSignal): Promise<void> {
    const seen = new Set<string>();
    const maxBytes = this.opts.maxFileBytes ?? 300_000;
    for await (const file of walkFiles(this.ws, this.ws.root, { signal, maxFiles: this.opts.maxFiles ?? 8_000 })) {
      if (!(INDEXABLE.test(file.name) || INDEXABLE_NAMES.has(file.name)) || isNoisyFile(file.name)) continue;
      const st = await this.ws.stat(file.abs);
      if (!st || st.type !== 'file' || st.size > maxBytes) continue;
      seen.add(file.abs);
      const existing = this.entries.get(file.abs);
      if (existing && existing.mtimeMs === st.mtimeMs && existing.size === st.size) continue;
      this.remove(file.abs);
      let text: string;
      try {
        text = await this.ws.readFile(file.abs);
      } catch {
        continue;
      }
      if (!looksBinary(text)) this.add(file.abs, file.rel, st, text);
    }
    for (const abs of [...this.entries.keys()]) {
      if (!seen.has(abs)) this.remove(abs);
    }
    if (this.chunks.length > this.chunkCount * 2 + 1_000) this.compact();
    this.refreshedAt = Date.now();
  }

  private add(abs: string, rel: string, st: FileStat, text: string): void {
    const size = this.opts.chunkLines ?? 60;
    const lines = text.split(/\r?\n/);
    const pathTerms = tokenize(rel);
    const entry: Entry = { rel, mtimeMs: st.mtimeMs, size: st.size, chunks: [] };
    for (let start = 0; start < lines.length; start += size) {
      const terms = tokenize(lines.slice(start, start + size).join('\n'));
      if (!terms.length && start > 0) continue;
      terms.push(...pathTerms, ...pathTerms);
      if (!terms.length) continue;
      const tf = new Map<string, number>();
      for (const term of terms) tf.set(term, (tf.get(term) ?? 0) + 1);
      for (const term of tf.keys()) this.df.set(term, (this.df.get(term) ?? 0) + 1);
      entry.chunks.push(this.chunks.push({ file: abs, start: start + 1, end: Math.min(lines.length, start + size), length: terms.length, tf }) - 1);
      this.totalLength += terms.length;
      this.chunkCount++;
    }
    this.entries.set(abs, entry);
  }

  private remove(abs: string): void {
    const entry = this.entries.get(abs);
    if (!entry) return;
    for (const id of entry.chunks) {
      const chunk = this.chunks[id];
      if (!chunk) continue;
      for (const term of chunk.tf.keys()) {
        const count = (this.df.get(term) ?? 1) - 1;
        if (count > 0) this.df.set(term, count);
        else this.df.delete(term);
      }
      this.totalLength -= chunk.length;
      this.chunkCount--;
      this.chunks[id] = undefined;
    }
    this.entries.delete(abs);
  }

  private compact(): void {
    const next: Chunk[] = [];
    for (const entry of this.entries.values()) {
      entry.chunks = entry.chunks.flatMap((id) => {
        const chunk = this.chunks[id];
        return chunk ? [next.push(chunk) - 1] : [];
      });
    }
    this.chunks = next;
  }
}

export function searchCodeTool(index: CodeIndex): Tool<{ query: string; limit?: number }> {
  return {
    name: 'search_code',
    description:
      'Find the files most relevant to a description, such as "where users log in" or "wallpaper download", using a local index of file names, identifiers and text. Use it when you do not know where something lives; use grep for an exact string.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you are looking for, in words or identifiers' },
        limit: { type: 'integer', description: 'Maximum number of files. Default 8' },
      },
      required: ['query'],
    },
    kind: 'read',
    label: (args) => `Search code for "${args.query}"`,
    async prepare(args, ctx) {
      return {
        run: async () => {
          await index.ensureFresh(ctx.signal);
          const hits = index.search(args.query, Math.min(20, Math.max(1, args.limit ?? 8)));
          if (!hits.length) {
            return { content: `No indexed files match "${args.query}". Try different words, or grep for an exact string.`, summary: 'no matches' };
          }
          const lines = [`Files most relevant to "${args.query}", best match first:`];
          for (const [i, hit] of hits.entries()) {
            lines.push(`${i + 1}. ${hit.path}:${hit.start}-${hit.end} (matches: ${hit.matched.join(', ')})`);
            const snippet = await index.snippet(hit);
            if (snippet) lines.push(snippet);
          }
          return { content: lines.join('\n'), summary: `${hits.length} file${hits.length === 1 ? '' : 's'}` };
        },
      };
    },
  };
}
