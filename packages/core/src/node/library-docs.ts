import { toolError, type Tool } from '../tools/types';
import { truncateMiddle } from '../util/text';

/**
 * Current documentation for a library, from Context7's public index, so the
 * agent checks an API instead of recalling it (python-pptx's colours, a
 * framework's new routing). Only the library name and the topic leave the
 * machine, like a search query; no code or file is sent.
 */

interface Args {
  library: string;
  topic: string;
  max_chars?: number;
}

const BASE = 'https://context7.com/api/v2';
const DEFAULT_CHARS = 6_000;

interface SearchResult {
  id: string;
  title?: string;
  state?: string;
  trustScore?: number;
  benchmarkScore?: number;
  totalSnippets?: number;
}

interface Snippets {
  codeSnippets?: { codeTitle?: string; codeDescription?: string; codeList?: { code?: string; language?: string }[] }[];
  infoSnippets?: { content?: string; breadcrumb?: string }[];
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The library asked for: Context7 lists results by relevance, so the first
 * whose name or id is the library wins; otherwise its top result.
 */
export function pickLibrary(results: SearchResult[], library = ''): SearchResult | undefined {
  const valid = results.filter((r) => typeof r.id === 'string' && r.id.startsWith('/') && r.state !== 'error');
  const want = squash(library);
  const named = want ? valid.find((r) => squash(r.title ?? '') === want || squash(r.id.split('/').pop() ?? '') === want) : undefined;
  return named ?? valid[0];
}

export function formatDocs(library: SearchResult, docs: Snippets, maxChars: number): string {
  const parts: string[] = [`${library.title ?? library.id} (${library.id}), from Context7:`];
  for (const s of docs.codeSnippets ?? []) {
    const code = (s.codeList ?? []).map((c) => c.code ?? '').filter(Boolean).join('\n');
    if (!code) continue;
    parts.push(`### ${s.codeTitle ?? 'Example'}${s.codeDescription ? `\n${s.codeDescription}` : ''}\n\`\`\`\n${code}\n\`\`\``);
  }
  for (const s of docs.infoSnippets ?? []) {
    if (s.content) parts.push(`${s.breadcrumb ? `### ${s.breadcrumb}\n` : ''}${s.content}`);
  }
  return truncateMiddle(parts.join('\n\n'), maxChars, 0.85);
}

export const libraryDocsTool: Tool<Args> = {
  name: 'library_docs',
  description:
    "Look up current documentation and examples for a library or framework (e.g. python-pptx, Next.js, FastAPI, EF Core) on a specific topic. Use it before writing code against an API you are not certain of, and when an error suggests you used an API wrongly.",
  parameters: {
    type: 'object',
    properties: {
      library: { type: 'string', description: 'The library or framework name, e.g. "python-pptx" or "next.js"' },
      topic: { type: 'string', description: 'What you need, e.g. "set a shape fill colour" or "middleware for auth"' },
      max_chars: { type: 'integer', description: 'Maximum characters to return. Default 6000' },
    },
    required: ['library', 'topic'],
  },
  kind: 'read',
  label: (a) => `Docs: ${a.library} — ${a.topic}`,
  async prepare(args, ctx) {
    const library = args.library.trim().slice(0, 80);
    const topic = args.topic.trim().slice(0, 200);
    if (!library || !topic) return toolError('Give both the library name and the topic.');
    const maxChars = Math.max(1_000, Math.min(15_000, Math.floor(args.max_chars ?? DEFAULT_CHARS)));
    return {
      run: async () => {
        const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(20_000)]);
        const get = async (path: string) => {
          const res = await fetch(`${BASE}${path}`, { signal, headers: { accept: 'application/json' } });
          if (res.status === 429) throw new Error('Context7 is rate-limiting requests right now; try again shortly or use fetch_url on the official docs.');
          if (!res.ok) throw new Error(`Context7 answered ${res.status}.`);
          return res.json() as Promise<unknown>;
        };
        try {
          const search = (await get(`/libs/search?libraryName=${encodeURIComponent(library)}&query=${encodeURIComponent(topic)}`)) as { results?: SearchResult[] };
          const found = pickLibrary(search.results ?? [], library);
          if (!found) return toolError(`No documentation found for "${library}". Try the official site with fetch_url.`);
          const docs = (await get(`/context?libraryId=${encodeURIComponent(found.id)}&query=${encodeURIComponent(topic)}&type=json`)) as Snippets;
          const text = formatDocs(found, docs, maxChars);
          return { content: text, summary: `${found.title ?? found.id}: ${(docs.codeSnippets?.length ?? 0) + (docs.infoSnippets?.length ?? 0)} snippets` };
        } catch (err) {
          return toolError(`Could not read the documentation: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    };
  },
};
