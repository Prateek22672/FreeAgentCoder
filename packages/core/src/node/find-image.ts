import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { displayPath } from '../workspace/types';
import { toolError, type Tool } from '../tools/types';

/**
 * A real, freely licensed photo or illustration for a document, slide or
 * page: searched on Wikimedia Commons (then Openverse), downloaded into the
 * project, and returned with the credit line to print. Only the search words
 * leave the machine. Licences that forbid commercial use or changes are
 * skipped, so the image can go in any deck or site.
 */

interface Args {
  query: string;
  save_as: string;
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
const OK_LICENSE = /^(?:cc0|pd|public domain|cc[ -]by(?:[ -]sa)?(?:[ -]\d(?:\.\d)?)?(?: \w+)?|no restrictions|attribution(?: share alike)?)$/i;
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

export const findImageTool: Tool<Args> = {
  name: 'find_image',
  description:
    'Find a real, freely licensed photo for a slide, document or page (Wikimedia Commons, then Openverse) and save it in the project. Returns the image, alternatives and the credit line to print on a sources slide or caption. Use specific words: "Kathmandu flood 2024 rescue", not "disaster".',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What the image shows, in specific words' },
      save_as: { type: 'string', description: 'Where to save it in the project, e.g. assets/flood.jpg' },
      min_width: { type: 'integer', description: 'Smallest acceptable width in pixels. Default 1000' },
    },
    required: ['query', 'save_as'],
  },
  kind: 'write',
  label: (a) => `Find image: ${a.query}`,
  paths: (a, ws) => [ws.resolve(a.save_as)],
  async prepare(args, ctx) {
    const query = args.query.trim().slice(0, 120);
    if (!query) return toolError('Say what the image should show.');
    const target = ctx.workspace.resolve(args.save_as);
    if (!/\.(jpe?g|png|webp)$/i.test(target)) return toolError('save_as must end in .jpg, .png or .webp.');
    const minWidth = Math.max(300, Math.min(4000, Math.floor(args.min_width ?? 1000)));
    return {
      run: async () => {
        const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(30_000)]);
        try {
          let found = (await commons(query, signal).catch(() => [])).filter((c) => usable(c, minWidth));
          if (!found.length) found = (await openverse(query, signal).catch(() => [])).filter((c) => usable(c, minWidth));
          found.sort((a, b) => relevance(b.title, query) - relevance(a.title, query) || b.width - a.width);
          const best = found[0];
          if (!best) {
            return toolError(
              `No freely licensed image of "${query}" was found. Try broader words, or leave a clearly labelled image placeholder (what to show and the size) and tell the user to add one there.`,
            );
          }
          const res = await fetch(best.url, { signal, headers: { 'user-agent': UA } });
          const type = res.headers.get('content-type') ?? '';
          if (!res.ok || !type.startsWith('image/')) return toolError(`The image could not be downloaded (${res.status}). Try find_image again with other words.`);
          const bytes = new Uint8Array(await res.arrayBuffer());
          if (bytes.length > MAX_BYTES) return toolError('That image is too large to use; try again with other words.');
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, bytes);
          const shown = displayPath(ctx.workspace, target);
          const others = found.slice(1, 4).map((c) => `- ${c.title} (${c.width}×${c.height}, ${c.license}): ${c.url}`);
          return {
            content: [
              `Saved ${shown} (${best.width}×${best.height}, ${Math.round(bytes.length / 1024)} KB): "${best.title}".`,
              `Credit to print: ${creditLine(best)}`,
              'Check the title fits what the slide or page says; if it does not, call find_image again with more specific words.',
              ...(others.length ? ['Alternatives (pass more specific words to get one of these):', ...others] : []),
            ].join('\n'),
            summary: `${shown} · ${best.license}`,
          };
        } catch (err) {
          return toolError(`Image search failed: ${err instanceof Error ? err.message : String(err)}. Leave a labelled placeholder and tell the user where an image should go.`);
        }
      },
    };
  },
};
