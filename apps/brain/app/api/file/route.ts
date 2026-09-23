import { fail, isResponse, json, requireBrain } from '@/lib/http';

export const runtime = 'nodejs';

/** Serves only files that were ingested — never an arbitrary path. */
export async function GET(request: Request) {
    const url = new URL(request.url);
    const brain = requireBrain(url.searchParams.get('id'));
    if (isResponse(brain)) return brain;
    const path = url.searchParams.get('path') ?? '';
    const file = brain.byPath.get(path);
    if (!file) return fail('That file is not part of this analysis.', 404);
    return json({ path: file.path, text: file.text, bytes: file.bytes, url: `${brain.analysis.meta.url}/blob/${brain.analysis.meta.ref}/${file.path}` });
}
