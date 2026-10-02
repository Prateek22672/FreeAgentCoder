import { labAuthorised, saveResult, type LabCategory, type LabTurn } from '@/lib/lab';

export const runtime = 'nodejs';

const CATEGORIES = new Set(['app', 'web', 'ml', 'followup', 'other']);
const num = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** A finished test run from the extension. Needs the lab token. */
export async function POST(request: Request): Promise<Response> {
    if (!labAuthorised(request)) return Response.json({ error: 'Lab token missing or wrong.' }, { status: 401 });
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: 'Not a valid result.' }, { status: 400 });
    const turns: LabTurn[] = (Array.isArray(body.turns) ? body.turns : []).slice(0, 20).map((t: Record<string, unknown>) => ({
        prompt: str(t.prompt, 2000),
        reason: str(t.reason, 40),
        durationMs: num(t.durationMs, 3_600_000),
        tokens: num(t.tokens, 50_000_000),
        steps: num(t.steps, 1000),
        requests: num(t.requests, 1000),
        models: (Array.isArray(t.models) ? t.models : []).slice(0, 10).map((m) => str(m, 80)),
        filesChanged: (Array.isArray(t.filesChanged) ? t.filesChanged : []).slice(0, 200).map((f) => str(f, 300)),
        usedFyx: t.usedFyx === true,
    }));
    const id = await saveResult({
        taskId: str(body.taskId, 60),
        title: str(body.title, 120),
        category: (CATEGORIES.has(String(body.category)) ? body.category : 'other') as LabCategory,
        extension: str(body.extension, 20),
        turns,
        transcript: str(body.transcript, 200_000),
    });
    return Response.json({ id });
}
