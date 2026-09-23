import { rankHits, roleOf } from '@agentic/project-brain';
import { fail, isResponse, json, readBody, requireBrain } from '@/lib/http';

export const runtime = 'nodejs';

export async function POST(request: Request) {
    const body = await readBody<{ id?: string; q?: string }>(request);
    const brain = requireBrain(body?.id);
    if (isResponse(brain)) return brain;
    const query = typeof body?.q === 'string' ? body.q.trim().slice(0, 300) : '';
    if (!query) return fail('Type something to search for.');

    // Over-fetch, then rank implementation above tests, docs and examples.
    const hits = rankHits(brain.index.search(query, 80), query, 25).map((hit) => {
        const lines = brain.byPath.get(hit.path)?.text.split('\n') ?? [];
        const from = Math.max(0, hit.start - 1);
        const to = Math.min(lines.length, Math.max(hit.end, hit.start + 1), from + 14);
        return {
            path: hit.path,
            start: hit.start,
            end: hit.end,
            matched: hit.matched,
            role: roleOf(hit.path),
            snippet: lines.slice(from, to).join('\n'),
            snippetStart: from + 1,
        };
    });
    return json({ query, hits });
}
