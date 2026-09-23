import { analyzeImpact, rankHits } from '@agentic/project-brain';
import { fail, isResponse, json, readBody, requireBrain } from '@/lib/http';

export const runtime = 'nodejs';

export async function POST(request: Request) {
    const body = await readBody<{ id?: string; q?: string; file?: string }>(request);
    const brain = requireBrain(body?.id);
    if (isResponse(brain)) return brain;

    // "What depends on this file?" — only for a file that was actually ingested.
    if (typeof body?.file === 'string' && body.file) {
        if (!brain.known.has(body.file)) return fail('That file is not part of this analysis.', 404);
        return json(analyzeImpact({ query: `Change ${body.file}`, input: brain.input, graph: brain.graph, dependencies: brain.analysis.dependencies, files: [body.file] }));
    }

    const query = typeof body?.q === 'string' ? body.q.trim().slice(0, 500) : '';
    if (!query) return fail('Describe the change you are considering.');

    const result = analyzeImpact({
        query,
        input: brain.input,
        graph: brain.graph,
        dependencies: brain.analysis.dependencies,
        // The strongest search hits count as direct hits too.
        searchHits: rankHits(brain.index.search(query, 40), query, 5).map((hit) => hit.path),
    });
    return json(result);
}
