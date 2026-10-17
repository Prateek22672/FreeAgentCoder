import { describe, expect, it } from 'vitest';
import { siteImageSearch } from './stockImages';

const photo = { title: 'Wind turbines at sunset', url: 'https://images.pexels.com/photos/9.jpeg?w=1920', width: 1920, height: 1280, license: 'Pexels License', author: 'Ana', source: 'https://www.pexels.com/photo/9/' };

function fakeFetch(answers: { status?: number; body: unknown }[]) {
    const calls: { url: string; auth?: string }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
        calls.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.authorization });
        const next = answers.shift() ?? { body: { photos: [] } };
        return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
    }) as typeof fetch;
    return { fetcher, calls };
}

describe('the site stock-photo search', () => {
    it('sends only the words and the trial id, and keeps well-formed photos', async () => {
        const { fetcher, calls } = fakeFetch([{ body: { photos: [photo, { title: 'broken' }, { ...photo, url: 'http://insecure/x.jpg' }] } }]);
        const search = siteImageSearch(() => '0f8fad5b-d9cb-469f-a165-70867728950e', fetcher);
        const found = await search('wind turbines sunset', 1000, new AbortController().signal);
        expect(found).toEqual([photo]);
        expect(calls[0]!.url).toMatch(/\/api\/images\/search\?q=wind%20turbines%20sunset&min_width=1000$/);
        expect(calls[0]!.auth).toBe('Bearer fact_0f8fad5b-d9cb-469f-a165-70867728950e');
    });

    it('stops asking for a while when the site has no keys or says enough for this hour', async () => {
        const { fetcher, calls } = fakeFetch([{ body: { photos: [], note: 'No photo keys in the pool.' } }]);
        const search = siteImageSearch(() => 'id', fetcher);
        await search('a', 1000, new AbortController().signal);
        expect(await search('b', 1000, new AbortController().signal)).toEqual([]);
        expect(calls).toHaveLength(1);

        const limited = fakeFetch([{ status: 429, body: { error: 'Too many' } }]);
        const again = siteImageSearch(() => 'id', limited.fetcher);
        await again('a', 1000, new AbortController().signal);
        await again('b', 1000, new AbortController().signal);
        expect(limited.calls).toHaveLength(1);
    });
});
