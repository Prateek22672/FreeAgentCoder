import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { displayPath } from '../workspace/types';
import { toolError, type Tool } from '../tools/types';

/**
 * A real, freely licensed photo or illustration for a document, slide or
 * page: searched with the host's stock-photo search when it has one (see
 * useImageSearch), then on Wikimedia Commons and Openverse, downloaded into
 * the project, and returned with the credit line to print. Only the search
 * words leave the machine. Licences that forbid commercial use or changes are
 * skipped, so the image can go in any deck or site.
 */

interface Args {
  query?: string;
  save_as?: string;
  images?: { query: string; save_as: string }[];
  min_width?: number;
}

export interface ImageCandidate {
  title: string;
  url: string;
  width: number;
  height: number;
  license: string;
  author: string;
  source: string;
}

const UA = 'FreeAgentCoder/0.6 (https://brain-rho-roan.vercel.app; images for user documents)';
const MAX_BYTES = 12 * 1024 * 1024;
const OK_LICENSE = /^(?:cc0|pd|public domain|cc[ -]by(?:[ -]sa)?(?:[ -]\d(?:\.\d)?)?(?: \w+)?|no restrictions|attribution(?: share alike)?|pexels license|pixabay content license|unsplash license)$/i;
const strip = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Usable for any document: no "non-commercial" or "no derivatives" terms, and big enough. */
export function usable(c: ImageCandidate, minWidth: number): boolean {
  return c.width >= minWidth && !/\bnc\b|non-?commercial|\bnd\b|no ?deriv/i.test(c.license) && OK_LICENSE.test(c.license.trim());
}

/** The words of the query a title shares, as a rough relevance score. */
export function relevance(title: string, query: string): number {
  const words = new Set(title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  return query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && words.has(w)).length;
}

export function creditLine(c: ImageCandidate): string {
  return `${c.title} — ${c.author || 'unknown author'}, ${c.license}, via ${c.source}`;
}

async function commons(query: string, signal: AbortSignal): Promise<ImageCandidate[]> {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=12&gsrsearch=${encodeURIComponent(`${query} filetype:bitmap`)}&prop=imageinfo&iiprop=url|size|extmetadata|mime&iiurlwidth=1600&format=json&origin=*`;
  const res = await fetch(url, { signal, headers: { 'user-agent': UA } });
  if (!res.ok) return [];
  const body = (await res.json()) as { query?: { pages?: Record<string, { title: string; imageinfo?: Record<string, any>[] }> } };
  return Object.values(body.query?.pages ?? {}).flatMap((page) => {
    const info = page.imageinfo?.[0];
    if (!info || !/^image\/(jpeg|png|webp)$/.test(info.mime ?? '')) return [];
    const meta = info.extmetadata ?? {};
    return [
      {
        title: page.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''),
        url: info.thumburl ?? info.url,
        width: Number(info.thumbwidth ?? info.width) || 0,
        height: Number(info.thumbheight ?? info.height) || 0,
        license: strip(String(meta.LicenseShortName?.value ?? '')),
        author: strip(String(meta.Artist?.value ?? '')).slice(0, 80),
        source: info.descriptionurl ?? 'Wikimedia Commons',
      },
    ];
  });
}

async function openverse(query: string, signal: AbortSignal): Promise<ImageCandidate[]> {
  const res = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&license_type=commercial,modification&page_size=12`, { signal, headers: { 'user-agent': UA } });
  if (!res.ok) return [];
  const body = (await res.json()) as { results?: Record<string, any>[] };
  return (body.results ?? []).map((r) => ({
    title: String(r.title ?? '').slice(0, 120),
    url: String(r.url ?? ''),
    width: Number(r.width) || 0,
    height: Number(r.height) || 0,
    license: `CC ${String(r.license ?? '').toUpperCase()}${r.license_version ? ` ${r.license_version}` : ''}`.replace('CC CC0', 'CC0').replace('CC PDM', 'Public domain'),
    author: String(r.creator ?? '').slice(0, 80),
    source: String(r.foreign_landing_url ?? 'Openverse'),
  }));
}

/** A stock-photo search the host provides (the FreeAgentCoder site's Pexels, Pixabay and Unsplash keys). */
export type ImageSearch = (query: string, minWidth: number, signal: AbortSignal) => Promise<ImageCandidate[]>;

let stockSearch: ImageSearch | undefined;

/**
 * Sets the search tried before Wikimedia Commons: stock photos match a slide's
 * topic far better than archive scans. Pass undefined to search only the free
 * archives.
 */
export function useImageSearch(search: ImageSearch | undefined): void {
  stockSearch = search;
}

/** One picture: search, download, save; the lines to report, or why it failed. */
async function findOne(query: string, saveAs: string, minWidthArg: number | undefined, ctx: Parameters<Tool<Args>['prepare']>[1]): Promise<{ ok: boolean; lines: string[]; summary: string }> {
  query = query.trim().slice(0, 120);
  if (!query) return { ok: false, lines: ['Say what the image should show.'], summary: 'no query' };
  const target = ctx.workspace.resolve(saveAs);
  if (!/\.(jpe?g|png|webp)$/i.test(target)) return { ok: false, lines: [`${saveAs}: save_as must end in .jpg, .png or .webp.`], summary: 'bad name' };
  const minWidth = Math.max(300, Math.min(4000, Math.floor(minWidthArg ?? 1000)));
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(30_000)]);
  try {
    // Stock results keep the provider's own ranking among equally relevant titles; archive results prefer the larger.
    let found = stockSearch ? (await stockSearch(query, minWidth, signal).catch(() => [])).filter((c) => usable(c, minWidth)) : [];
    const stock = found.length > 0;
    if (!found.length) found = (await commons(query, signal).catch(() => [])).filter((c) => usable(c, minWidth));
    if (!found.length) found = (await openverse(query, signal).catch(() => [])).filter((c) => usable(c, minWidth));
    found.sort((a, b) => relevance(b.title, query) - relevance(a.title, query) || (stock ? 0 : b.width - a.width));
    const best = found[0];
    if (!best) {
      return {
        ok: false,
        lines: [`No freely licensed image of "${query}" was found. Try broader words, or give the slide an imageNote (what to show) and tell the user which slide needs a picture.`],
        summary: 'not found',
      };
    }
    const res = await fetch(best.url, { signal, headers: { 'user-agent': UA } });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('image/')) return { ok: false, lines: [`The image for "${query}" could not be downloaded (${res.status}).`], summary: 'download failed' };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) return { ok: false, lines: [`The image for "${query}" is too large to use.`], summary: 'too large' };
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    const shown = displayPath(ctx.workspace, target);
    const others = found.slice(1, 4).map((c) => `- ${c.title} (${c.width}×${c.height}, ${c.license}): ${c.url}`);
    return {
      ok: true,
      lines: [
        `Saved ${shown} (${best.width}×${best.height}, ${Math.round(bytes.length / 1024)} KB): "${best.title}".`,
        `Credit to print: ${creditLine(best)}`,
        'Check the title fits what the slide says; if it does not, leave this picture out rather than use one that does not show the point.',
        ...(others.length ? ['Alternatives (pass more specific words to get one of these):', ...others] : []),
      ],
      summary: `${shown} · ${best.license}`,
    };
  } catch (err) {
    return { ok: false, lines: [`Image search for "${query}" failed: ${err instanceof Error ? err.message : String(err)}.`], summary: 'failed' };
  }
}

export const findImageTool: Tool<Args> = {
  name: 'find_image',
  description:
    'Find real, freely licensed photos for slides, documents or pages (stock photos from Pexels, Pixabay and Unsplash when available, then Wikimedia Commons and Openverse) and save them in the project, with the credit line to print. Get several at once with images: [{ query, save_as }] (up to 6), which saves steps. Use specific, photographable words: "robot arms in a car factory", not "automation".',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What the image shows, in specific words (for one image)' },
      save_as: { type: 'string', description: 'Where to save it in the project, e.g. .freeagentcoder/images/flood.jpg' },
      images: {
        type: 'array',
        description: 'Several images in one call, up to 6',
        items: { type: 'object', properties: { query: { type: 'string' }, save_as: { type: 'string' } }, required: ['query', 'save_as'] },
      },
      min_width: { type: 'integer', description: 'Smallest acceptable width in pixels. Default 1000' },
    },
  },
  kind: 'write',
  label: (a) => (a.images?.length ? `Find ${a.images.length} images` : `Find image: ${a.query ?? ''}`),
  paths: (a, ws) => (a.images?.length ? a.images.map((i) => ws.resolve(i.save_as)) : a.save_as ? [ws.resolve(a.save_as)] : []),
  async prepare(args, ctx) {
    const wanted = (args.images?.length ? args.images : args.query && args.save_as ? [{ query: args.query, save_as: args.save_as }] : []).slice(0, 6);
    if (!wanted.length) return toolError('Give query and save_as, or images: [{ query, save_as }].');
    return {
      run: async () => {
        const results = [];
        for (const item of wanted) {
          results.push(await findOne(item.query, item.save_as, args.min_width, ctx));
        }
        const saved = results.filter((r) => r.ok).length;
        const content = results.length === 1 ? results[0]!.lines.join('\n') : results.map((r, i) => `${i + 1}. ${r.lines.join('\n   ')}`).join('\n');
        if (!saved) return toolError(content);
        return { content, summary: results.length === 1 ? results[0]!.summary : `${saved} of ${results.length} saved` };
      },
    };
  },
};
