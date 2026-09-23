import { parseReport, recordReport, REPORT_EVERY_SECONDS } from '@/lib/stats';
import { store } from '@/lib/kv';

export const runtime = 'nodejs';

/** A report is a few hundred bytes; anything much larger is not one. */
const MAX_BODY = 8_000;

/**
 * Where the extension sends its anonymous counts, if the person said yes.
 *
 * Everything is validated before it is stored, one report per install per hour
 * is counted, and the answer never says whether a report was kept — there is
 * nothing here worth probing for.
 */
export async function POST(request: Request): Promise<Response> {
    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > MAX_BODY) {
        return new Response(null, { status: 413 });
    }
    const body = await request.text();
    if (body.length > MAX_BODY) {
        return new Response(null, { status: 413 });
    }

    let report;
    try {
        report = parseReport(JSON.parse(body));
    } catch {
        return new Response(null, { status: 400 });
    }
    if (!report) {
        return new Response(null, { status: 400 });
    }

    try {
        if (await store.firstIn(`pb:seen:${report.install}`, REPORT_EVERY_SECONDS)) {
            await recordReport(report);
        }
    } catch {
        // Counting is never worth failing someone's editor over.
    }
    return new Response(null, { status: 204 });
}
