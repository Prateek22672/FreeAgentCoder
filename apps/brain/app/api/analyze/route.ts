import { configuredProviders } from '@/lib/ai';
import type { Progress } from '@/lib/github';
import { RepoError } from '@/lib/github';
import { failFrom, fail, json, readBody } from '@/lib/http';
import { loadBrain, type Brain } from '@/lib/store';

export const runtime = 'nodejs';
export const maxDuration = 120;

function view(brain: Brain) {
    return {
        id: brain.id,
        analysis: brain.analysis,
        secrets: brain.secrets,
        timings: brain.timings,
        indexedFiles: brain.index.fileCount,
        readPaths: [...brain.known],
        ai: configuredProviders(),
    };
}

/**
 * POST { repo }. With `Accept: application/x-ndjson` the response streams
 * progress events and ends with { type: 'done', result } or { type: 'error' };
 * otherwise it is a single JSON body.
 */
export async function POST(request: Request) {
    const body = await readBody<{ repo?: string }>(request);
    if (!body?.repo || typeof body.repo !== 'string' || body.repo.length > 300) return fail('Enter a GitHub repository.');
    const repo = body.repo;

    if (!request.headers.get('accept')?.includes('application/x-ndjson')) {
        try {
            return json(view(await loadBrain(repo)));
        } catch (error) {
            return failFrom(error);
        }
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            const progress: Progress = (event) => send({ type: 'progress', ...event });
            try {
                send({ type: 'progress', step: 'list', message: 'Contacting GitHub' });
                send({ type: 'done', result: view(await loadBrain(repo, progress)) });
            } catch (error) {
                if (!(error instanceof RepoError)) console.error('[brain analyze]', error instanceof Error ? error.message : error);
                send({ type: 'error', message: error instanceof RepoError ? error.message : 'Something went wrong while analyzing this repository.' });
            } finally {
                controller.close();
            }
        },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
}
