import { resolveAccess } from '@/lib/access';
import { fail, readBody } from '@/lib/http';
import { readBrief } from '@/lib/brief';
import { buildSystem, kitChanges, projectContext } from '@/lib/playgroundPrompt';
import { parseEdit, SAFE_PATH } from '@/lib/playgroundEdits';

export const runtime = 'nodejs';
// A designed site is a long answer, sometimes finished over a second or third call.
export const maxDuration = 300;

/**
 * The playground's agent: given the project's files and what the person wants,
 * it returns the files to write and delete. The browser applies them, and the
 * in-browser runtime picks them up live. Nothing is stored here — the project
 * lives in the visitor's browser.
 */

/** An imported repository can be bigger than one request; only the part that matters is sent. */
const MAX_UPLOAD_CHARS = 3_000_000;
const MAX_HISTORY = 8;
/** Calls that carry on a reply cut off by the output limit, and the time they may take together. */
const MAX_CONTINUATIONS = 2;
const CONTINUE_BUDGET_MS = 200_000;
const CONTINUE = 'Your reply was cut off by the output limit. Continue exactly where it stopped, from the next character: no repetition, no preamble, and close every tag you open.';



export async function POST(request: Request): Promise<Response> {
    const body = await readBody<{ files?: Record<string, unknown>; request?: string; history?: { role?: string; content?: string }[]; brief?: unknown }>(request);
    const ask = typeof body?.request === 'string' ? body.request.trim().slice(0, 4_000) : '';
    if (!ask) return fail('Say what you want built or changed.');

    const files: Record<string, string> = {};
    let total = 0;
    for (const [path, content] of Object.entries(body?.files ?? {})) {
        if (!SAFE_PATH.test(path) || typeof content !== 'string') continue;
        total += content.length;
        if (total > MAX_UPLOAD_CHARS) return fail('This project is too large for Fyxable. Export it to GitHub and continue in VS Code with the free extension.', 413);
        files[path] = content;
    }

    const access = await resolveAccess(request, 'requests');
    if ('response' in access) return access.response;

    const brief = readBrief(body?.brief);
    // A website or app is built on the kit: add it first, so the agent can import from it.
    const kit = kitChanges(brief, files);
    Object.assign(files, kit);
    const project = projectContext(files, ask);
    const system = buildSystem(brief, ask, files);
    const history = (body?.history ?? [])
        .slice(-MAX_HISTORY)
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content!.slice(0, 2_000) }));

    try {
        const started = Date.now();
        const messages: { role: 'user' | 'assistant'; content: string }[] = [...history, { role: 'user', content: `The project now:
${project || '(empty)'}

Request: ${ask}` }];
        let text = '';
        let model = '';
        for (let call = 0; ; call++) {
            const stream = access.router.stream({ system, messages, tools: [], temperature: 0.2, signal: request.signal });
            let step = await stream.next();
            while (!step.done) step = await stream.next();
            text += step.value.content;
            model ||= step.value.model ?? '';
            // Cut off mid-file: ask for the rest, so the last file is not lost.
            if (step.value.stop !== 'max_tokens' || call >= MAX_CONTINUATIONS || Date.now() - started > CONTINUE_BUDGET_MS) break;
            messages.push({ role: 'assistant', content: step.value.content }, { role: 'user', content: CONTINUE });
        }
        const edit = parseEdit(text);
        // The kit files go back with the agent's own, unless it changed one of them.
        for (const [path, content] of Object.entries(kit)) {
            if (!edit.files.some((f) => f.path === path)) edit.files.push({ path, content });
        }
        const headers = new Headers({ 'content-type': 'application/json' });
        if (access.setCookie) headers.set('set-cookie', access.setCookie);
        return new Response(JSON.stringify({ ...edit, model, access: access.mode }), { headers });
    } catch (error) {
        access.refund();
        return fail(access.scrub(error instanceof Error ? error.message : 'The model could not be reached.').slice(0, 300), 502);
    }
}
