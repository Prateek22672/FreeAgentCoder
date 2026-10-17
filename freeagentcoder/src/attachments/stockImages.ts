import type { ImageCandidate, ImageSearch } from '@agentic/core/node';
import { SITE_URL } from '../shared/site';

/** How long to skip the site after it said it has no photo keys, or that this install searched enough for now. */
const QUIET_MS = 30 * 60_000;

const isPhoto = (p: unknown): p is ImageCandidate => {
    const c = p as Partial<ImageCandidate> | null;
    return (
        !!c &&
        typeof c.url === 'string' &&
        c.url.startsWith('https://') &&
        typeof c.title === 'string' &&
        typeof c.license === 'string' &&
        typeof c.author === 'string' &&
        typeof c.source === 'string' &&
        Number.isFinite(c.width) &&
        Number.isFinite(c.height)
    );
};

/**
 * find_image's first search: stock photos (Pexels, Pixabay, Unsplash) through
 * the FreeAgentCoder site, whose keys never leave its server. Sends only the
 * search words and the install's random trial id. Any failure returns nothing,
 * and find_image goes on to Wikimedia Commons and Openverse.
 */
export function siteImageSearch(installId: () => string, fetcher: typeof fetch = fetch): ImageSearch {
    let quietUntil = 0;
    return async (query, minWidth, signal) => {
        if (Date.now() < quietUntil) {
            return [];
        }
        const url = `${SITE_URL}/api/images/search?q=${encodeURIComponent(query)}&min_width=${minWidth}`;
        const response = await fetcher(url, {
            headers: { authorization: `Bearer fact_${installId()}` },
            signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        });
        if (response.status === 429) {
            quietUntil = Date.now() + QUIET_MS;
            return [];
        }
        if (!response.ok) {
            return [];
        }
        const body = (await response.json().catch(() => ({}))) as { photos?: unknown[]; note?: string };
        if (body.note && !body.photos?.length) {
            quietUntil = Date.now() + QUIET_MS;
        }
        return (body.photos ?? []).filter(isPhoto).slice(0, 10);
    };
}
