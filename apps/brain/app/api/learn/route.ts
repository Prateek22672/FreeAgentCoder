import { store } from '@/lib/kv';
import { learningAvailable, parseLearning, recordLearning } from '@/lib/learning';

export const runtime = 'nodejs';

/** A batch is a few kilobytes; anything much larger is not one. */
const MAX_BODY = 64_000;
/** One batch per install per minute: the extension sends at most every few tasks. */
const EVERY_SECONDS = 60;

/**
 * Where installs that chose "OK, start using the agent" send what they learned.
 * Every field is checked before it is stored, and the answer never says what
 * was kept: there is nothing here worth probing for.
 */
export async function POST(request: Request): Promise<Response> {
    if (!learningAvailable) return new Response(null, { status: 204 });
    if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return new Response(null, { status: 413 });
    const body = await request.text();
    if (body.length > MAX_BODY) return new Response(null, { status: 413 });
    let report;
    try {
        report = parseLearning(JSON.parse(body));
    } catch {
        return new Response(null, { status: 400 });
    }
    if (!report) return new Response(null, { status: 400 });
    try {
        if (await store.firstIn(`pb:learn:${report.install}`, EVERY_SECONDS)) {
            await recordLearning(report);
        }
    } catch {
        // A storage hiccup must not make the extension retry in a loop.
    }
    return new Response(null, { status: 204 });
}
