import { createHash } from 'node:crypto';
import { addressFrom, installFrom } from '@/lib/extTrial';
import { logEvent } from '@/lib/events';
import { imageKeys, recordPoolCall, restPoolKey, restSeconds, type ImageKey } from '@/lib/keypool';
import { store } from '@/lib/kv';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * Stock-photo search for the extension's find_image: Pexels, then Pixabay,
 * then Unsplash, with the site's keys (they never leave the server). Only the
 * search words and the install's random trial id arrive here. Answers are
 * cached for a day, as Pixabay asks, which also spares every provider's quota.
 */

const PER_INSTALL_HOUR = 120;
const PER_ADDRESS_HOUR = 300;
const CACHE_SECONDS = 24 * 60 * 60;
const WIDTH = 1920;
const PER_PAGE = 10;

export interface StockPhoto {
    title: string;
    url: string;
    width: number;
    height: number;
    license: string;
    author: string;
    source: string;
}

type Orientation = 'landscape' | 'portrait' | 'square' | undefined;

/** The size a photo comes out at when asked for WIDTH pixels wide (never larger than the original). */
function scaled(width: number, height: number): { width: number; height: number } {
    if (!width || !height || width <= WIDTH) return { width, height };
    return { width: WIDTH, height: Math.round((height * WIDTH) / width) };
}

const text = (v: unknown, max = 120) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

async function pexels(key: string, q: string, orientation: Orientation, signal: AbortSignal): Promise<{ status: number; photos: StockPhoto[]; retryAfter: string | null; detail: string }> {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=${PER_PAGE}${orientation ? `&orientation=${orientation}` : ''}`;
    const res = await fetch(url, { headers: { authorization: key }, signal, cache: 'no-store' });
    if (!res.ok) return { status: res.status, photos: [], retryAfter: untilReset(res.headers), detail: await res.text().catch(() => '') };
    const body = (await res.json()) as { photos?: Record<string, any>[] };
    const photos = (body.photos ?? []).map((p) => {
        const size = scaled(Number(p.width) || 0, Number(p.height) || 0);
        return {
            title: text(p.alt) || 'Photo',
            url: `${String(p.src?.original ?? '')}?auto=compress&cs=tinysrgb&w=${WIDTH}`,
            ...size,
            license: 'Pexels License',
            author: text(p.photographer, 80),
            source: String(p.url ?? 'Pexels'),
        };
    });
    return { status: 200, photos: photos.filter((p) => p.url.startsWith('https://')), retryAfter: null, detail: '' };
}

async function pixabay(key: string, q: string, orientation: Orientation, minWidth: number, signal: AbortSignal) {
    const turn = orientation === 'portrait' ? 'vertical' : orientation === 'landscape' ? 'horizontal' : 'all';
    const url = `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q.slice(0, 100))}&image_type=photo&safesearch=true&per_page=${PER_PAGE}&orientation=${turn}&min_width=${minWidth}`;
    const res = await fetch(url, { signal, cache: 'no-store' });
    if (!res.ok) return { status: res.status, photos: [] as StockPhoto[], retryAfter: untilReset(res.headers), detail: await res.text().catch(() => '') };
    const body = (await res.json()) as { hits?: Record<string, any>[] };
    const photos = (body.hits ?? []).map((h) => {
        // largeImageURL is scaled to at most 1280 pixels on its longer side.
        const w = Number(h.imageWidth) || 0;
        const ht = Number(h.imageHeight) || 0;
        const ratio = Math.min(1, 1280 / Math.max(w, ht, 1));
        return {
            title: text(h.tags) || 'Photo',
            url: String(h.largeImageURL ?? ''),
            width: Math.round(w * ratio),
            height: Math.round(ht * ratio),
            license: 'Pixabay Content License',
            author: text(h.user, 80),
            source: String(h.pageURL ?? 'Pixabay'),
        };
    });
    return { status: 200, photos: photos.filter((p) => p.url.startsWith('https://')), retryAfter: null, detail: '' };
}

async function unsplash(key: string, q: string, orientation: Orientation, signal: AbortSignal) {
    const turn = orientation === 'square' ? 'squarish' : orientation;
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=${PER_PAGE}&content_filter=high${turn ? `&orientation=${turn}` : ''}`;
    const headers = { authorization: `Client-ID ${key}`, 'accept-version': 'v1' };
    const res = await fetch(url, { headers, signal, cache: 'no-store' });
    if (!res.ok) return { status: res.status, photos: [] as StockPhoto[], retryAfter: untilReset(res.headers), detail: await res.text().catch(() => '') };
    const body = (await res.json()) as { results?: Record<string, any>[] };
    const results = body.results ?? [];
    // Unsplash asks apps to report a photo as downloaded when it is used; the top result is the one find_image takes.
    const top = results[0]?.links?.download_location;
    if (typeof top === 'string' && top.startsWith('https://api.unsplash.com/')) {
        await fetch(top, { headers, signal: AbortSignal.timeout(3_000) }).catch(() => undefined);
    }
    const photos = results.map((r) => {
        const size = scaled(Number(r.width) || 0, Number(r.height) || 0);
        return {
            title: text(r.alt_description ?? r.description) || 'Photo',
            url: `${String(r.urls?.raw ?? '')}&w=${WIDTH}&q=80&fm=jpg&fit=max`,
            ...size,
            license: 'Unsplash License',
            author: text(r.user?.name, 80),
            source: `${String(r.links?.html ?? 'https://unsplash.com')}?utm_source=freeagentcoder&utm_medium=referral`,
        };
    });
    return { status: 200, photos: photos.filter((p) => p.url.startsWith('https://')), retryAfter: null, detail: '' };
}

/** Seconds until an X-Ratelimit-Reset time (Pexels sends a Unix time), as a Retry-After value. */
function untilReset(headers: Headers): string | null {
    const retry = headers.get('retry-after');
    if (retry) return retry;
    const reset = Number(headers.get('x-ratelimit-reset'));
    if (!Number.isFinite(reset) || reset <= 0) return null;
    const seconds = reset > 1e9 ? reset - Date.now() / 1000 : reset;
    return seconds > 0 ? String(Math.ceil(seconds)) : null;
}

function search(k: ImageKey, q: string, orientation: Orientation, minWidth: number, signal: AbortSignal) {
    if (k.provider === 'pexels') return pexels(k.apiKey, q, orientation, signal);
    if (k.provider === 'pixabay') return pixabay(k.apiKey, q, orientation, minWidth, signal);
    return unsplash(k.apiKey, q, orientation, signal);
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function GET(request: Request): Promise<Response> {
    const install = installFrom(request);
    if (!install) return json({ error: 'This endpoint is for the FreeAgentCoder extension.' }, 401);
    const params = new URL(request.url).searchParams;
    const q = text(params.get('q'), 120);
    if (!q) return json({ error: 'Say what the picture should show (q).' }, 400);
    const minWidth = Math.max(300, Math.min(4000, Math.floor(Number(params.get('min_width')) || 1000)));
    const asked = params.get('orientation');
    const orientation: Orientation = asked === 'landscape' || asked === 'portrait' || asked === 'square' ? asked : undefined;

    const hour = `pb:imgsearch:${new Date().toISOString().slice(0, 13)}`;
    const address = addressFrom(request);
    const used = await store.counts(hour).catch(() => ({}) as Record<string, number>);
    if ((used[`i:${install}`] ?? 0) >= PER_INSTALL_HOUR || (used[`a:${address}`] ?? 0) >= PER_ADDRESS_HOUR) {
        return json({ error: 'Too many picture searches this hour; the free archives are still searched.', photos: [] }, 429);
    }
    await store.addCounts(hour, { [`i:${install}`]: 1, [`a:${address}`]: 1 }, 2 * 60 * 60).catch(() => undefined);

    const cacheKey = `pb:imgcache:${createHash('sha256').update(`${q.toLowerCase()}|${minWidth}|${orientation ?? ''}`).digest('hex').slice(0, 32)}`;
    const [cached] = await store.getMany([cacheKey]).catch(() => [null]);
    if (cached) return new Response(cached, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

    const keys = await imageKeys();
    if (!keys.length) return json({ photos: [], note: 'No photo keys in the pool.' });
    const signal = AbortSignal.timeout(12_000);
    const tried = new Set<string>();
    for (const k of keys) {
        // One key per provider: a second key of a provider that found nothing would find nothing too.
        if (tried.has(k.provider)) continue;
        try {
            const result = await search(k, q, orientation, minWidth, signal);
            if (result.status === 429) {
                const seconds = restSeconds(result.retryAfter, result.detail);
                await restPoolKey(k.id, seconds);
                void logEvent(`images:${k.provider}`, 'info', `Key ${k.id.slice(0, 6)} out of searches; resting ${seconds >= 3600 ? `${Math.round(seconds / 3600)} h` : `${seconds} s`}`);
                continue;
            }
            if (result.status !== 200) {
                await recordPoolCall(k.id, false);
                void logEvent(`images:${k.provider}`, 'warn', `${result.status}: ${result.detail.slice(0, 160)}`);
                continue;
            }
            await recordPoolCall(k.id, true);
            tried.add(k.provider);
            const photos = result.photos.filter((p) => p.width >= minWidth);
            if (!photos.length) continue;
            const body = JSON.stringify({ photos, provider: k.provider });
            await store.put(cacheKey, body, CACHE_SECONDS).catch(() => undefined);
            return new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
        } catch (error) {
            void logEvent(`images:${k.provider}`, 'warn', (error as Error).name === 'TimeoutError' ? 'Search timed out' : `Could not reach ${k.provider}`);
        }
    }
    return json({ photos: [] });
}
