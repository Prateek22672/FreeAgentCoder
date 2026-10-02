import { resolveAccess } from '@/lib/access';
import { fail, readBody } from '@/lib/http';
import { parseEdit, SAFE_PATH } from '@/lib/playgroundEdits';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * The playground's agent: given the project's files and what the person wants,
 * it returns the files to write and delete. The browser applies them, and the
 * in-browser runtime picks them up live. Nothing is stored here — the project
 * lives in the visitor's browser.
 */

const MAX_PROJECT_CHARS = 300_000;
/** An imported repository can be bigger than one request; only the part that matters is sent. */
const MAX_UPLOAD_CHARS = 3_000_000;
const MAX_HISTORY = 8;

const words = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
const fileBlock = (list: [string, string][]) => list.map(([path, content]) => `<file path="${path}">\n${content}\n</file>`).join('\n');

/**
 * The project as the model sees it. A small project is sent whole. A larger
 * one is sent as its full list of paths, plus whole files chosen for this
 * request: the manifest and entry points first, then the files whose path or
 * text shares the most words with the request, until the budget is used.
 */
function projectContext(files: Record<string, string>, ask: string): string {
    const all = Object.entries(files);
    if (all.reduce((sum, [, content]) => sum + content.length, 0) <= MAX_PROJECT_CHARS) return fileBlock(all);
    const want = words(ask);
    const score = ([path, content]: [string, string]) => {
        if (/(^|\/)(package\.json|index\.html|vite\.config\.\w+|main\.\w+|App\.\w+)$/.test(path)) return 1_000;
        const inPath = [...words(path)].filter((w) => want.has(w)).length * 20;
        const head = content.slice(0, 20_000).toLowerCase();
        return inPath + [...want].filter((w) => head.includes(w)).length;
    };
    const chosen: [string, string][] = [];
    let used = 0;
    for (const entry of [...all].sort((a, b) => score(b) - score(a))) {
        if (used + entry[1].length > MAX_PROJECT_CHARS * 0.85) continue;
        chosen.push(entry);
        used += entry[1].length;
    }
    const shown = new Set(chosen.map(([path]) => path));
    const others = all.filter(([path]) => !shown.has(path)).map(([path]) => path);
    return `${fileBlock(chosen)}\n\nOther files in the project, not shown. Never return a file you have not seen; if you need one, say which in the message:\n${others.join('\n')}`;
}

const SYSTEM = `You are the agent in FreeAgentCoder's playground: a small web project that runs in the user's browser with Node, npm and Vite.

You change the project by returning files. Reply in exactly this format and nothing else:
<message>One or two plain sentences: what you did, and anything the user must know.</message>
<file path="relative/path.ext">
the COMPLETE new content of the file
</file>
<delete path="relative/path.ext" />

Rules:
- Return every file you create or change in full. Never return a partial file, a diff, or "rest unchanged".
- Return only files that change. Keep the project's structure and style.
- package.json must keep a "dev" script; the runtime runs "npm run dev". Add any dependency you import to package.json.
- Use real, current package names and APIs only. No placeholders that look finished.
- Keep the project small and working: fewer, clear files beat many empty ones.
- A server must listen on port 3000; Vite serves the page itself.
- If the request is unclear or impossible here (Python, databases that need a server, native apps), say so in the message and change nothing.`;

export async function POST(request: Request): Promise<Response> {
    const body = await readBody<{ files?: Record<string, unknown>; request?: string; history?: { role?: string; content?: string }[] }>(request);
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

    const project = projectContext(files, ask);
    const history = (body?.history ?? [])
        .slice(-MAX_HISTORY)
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content!.slice(0, 2_000) }));

    try {
        const stream = access.router.stream({
            system: SYSTEM,
            messages: [...history, { role: 'user', content: `The project now:\n${project || '(empty)'}\n\nRequest: ${ask}` }],
            tools: [],
            temperature: 0.2,
            signal: request.signal,
        });
        let step = await stream.next();
        while (!step.done) step = await stream.next();
        const edit = parseEdit(step.value.content);
        const headers = new Headers({ 'content-type': 'application/json' });
        if (access.setCookie) headers.set('set-cookie', access.setCookie);
        return new Response(JSON.stringify({ ...edit, model: step.value.model, access: access.mode }), { headers });
    } catch (error) {
        access.refund();
        return fail(access.scrub(error instanceof Error ? error.message : 'The model could not be reached.').slice(0, 300), 502);
    }
}
