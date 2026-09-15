import { toolError, type Tool } from '../tools/types';
import { truncateMiddle } from '../util/text';

interface Args {
  url: string;
  max_chars?: number;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function htmlToText(html: string): string {
  let s = html.replace(/<(script|style|noscript|svg|head|template|iframe)\b[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<h([1-6])[^>]*>/gi, (_, n: string) => `\n${'#'.repeat(Number(n))} `);
  s = s.replace(/<li[^>]*>/gi, '\n- ');
  s = s.replace(/<(br|hr)\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|section|article|header|footer|main|li|tr|h[1-6]|pre|blockquote|ul|ol|table)>/gi, '\n');
  s = s.replace(/<a\s[^>]*href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) => {
    const label = text.replace(/<[^>]+>/g, '').trim();
    return label ? `[${label}](${href})` : '';
  });
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const fetchUrlTool: Tool<Args> = {
  name: 'fetch_url',
  description:
    'Fetch a web page (documentation, an API reference, a GitHub file) and return it as readable text. Only http(s) URLs.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The full URL' },
      max_chars: { type: 'integer', description: 'Maximum characters to return. Default 15000' },
    },
    required: ['url'],
  },
  kind: 'network',
  label: (a) => `Fetch ${a.url}`,
  url: (a) => a.url,
  async prepare(args, ctx) {
    let url: URL;
    try {
      url = new URL(args.url);
    } catch {
      return toolError(`Not a valid URL: ${args.url}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return toolError('Only http and https URLs can be fetched.');
    return {
      run: async () => {
        const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(20_000)]);
        let res: Response;
        try {
          res = await fetch(url, {
            signal,
            redirect: 'follow',
            headers: {
              'user-agent': 'Mozilla/5.0 (compatible; Agentic/0.1; +https://github.com/agentic-dev/agentic)',
              accept: 'text/html,text/plain,text/markdown,application/json;q=0.9,*/*;q=0.5',
            },
          });
        } catch (err) {
          return toolError(`Could not fetch ${url.href}: ${(err as Error).message}`);
        }
        const type = res.headers.get('content-type') ?? '';
        if (!res.ok) return toolError(`${url.href} returned HTTP ${res.status} ${res.statusText}.`);
        if (/image|video|audio|octet-stream|pdf|zip/.test(type)) {
          return toolError(`${url.href} is not a text page (${type}).`);
        }
        const body = await res.text();
        let text = body;
        if (type.includes('html') || /^\s*<(!doctype|html)/i.test(body)) text = htmlToText(body);
        else if (type.includes('json')) {
          try {
            text = JSON.stringify(JSON.parse(body), null, 2);
          } catch {
            // leave as-is
          }
        }
        const max = Math.max(1000, Math.min(60_000, args.max_chars ?? 15_000));
        return {
          content: `${res.url}\n\n${truncateMiddle(text, max, 0.7)}`,
          summary: `${Math.round(text.length / 1000)}k chars`,
        };
      },
    };
  },
};
