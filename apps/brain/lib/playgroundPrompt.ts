import { briefText, type Brief } from './brief';
import { designBrief, hasKit, KIT_FILES, KIT_PREFIX, usesKit } from './design';

/**
 * What the Fyxable agent is told: its rules, the person's brief, and the
 * project as it stands. Shared by the playground route and the design
 * evaluation script, so both send exactly the same thing.
 */

const MAX_PROJECT_CHARS = 300_000;

const words = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
const fileBlock = (list: [string, string][]) => list.map(([path, content]) => `<file path="${path}">\n${content}\n</file>`).join('\n');

/**
 * The project as the model sees it. A small project is sent whole. A larger
 * one is sent as its full list of paths, plus whole files chosen for this
 * request: the manifest and entry points first, then the files whose path or
 * text shares the most words with the request, until the budget is used.
 */
export function projectContext(source: Record<string, string>, ask: string): string {
    // The kit's own files are documented in the instructions and never change, so they are not re-sent.
    const files = Object.fromEntries(Object.entries(source).filter(([path]) => !(path.startsWith(KIT_PREFIX) && KIT_FILES[path] === source[path])));
    const kitNote = Object.keys(files).length < Object.keys(source).length ? `\n\nAlso in the project, unchanged and not shown: the kit (${Object.keys(KIT_FILES).join(', ')}).` : '';
    return projectFiles(files, ask) + kitNote;
}

function projectFiles(files: Record<string, string>, ask: string): string {
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

export const SYSTEM = `You are the agent in Fyxable, Free Agent Coder's app builder: a small web project that runs in the user's browser with Node, npm and Vite.

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
- If the request is unclear or impossible here (Python, databases that need a server, native apps), say so in the message and change nothing.

Design, whenever you build or change pages or screens:
- Start from a design system in one stylesheet: CSS custom properties for colours (background, surface, text, muted, accent, border), a type scale of five sizes, spacing steps (4, 8, 12, 16, 24, 32, 48, 64, 96px) and two radii. Use them everywhere; no stray hex values in components.
- Typography: load one or two Google Fonts with a <link> in index.html, a display face for headings and a text face for body. Headings tight (line-height 1.05 to 1.15, letter-spacing -0.02em), body 16 to 18px at line-height 1.5 to 1.6, text lines under 70 characters.
- Layout: a centred container of 1120 to 1200px with 24px side padding; sections with real vertical rhythm (96 to 128px on desktop, 56px on phones); CSS grid for cards; everything responsive at 390, 768 and 1280 wide, checked in your head before you answer.
- A landing page, in order: a nav with the name and one button; a hero with one headline under ten words, one sub-line and one primary call to action; then proof or features in a grid of three or four; how it works; pricing or a second call to action; FAQ or testimonials; a footer. If the brief lists sections, build exactly those, in that order.
- Real words that fit the idea: never "Lorem ipsum", "Your Company", "Feature 1", a demo counter or a leftover from the starter. Write the copy as the product's own voice.
- No stock photos and no external image URLs. Make visuals from colour, gradients, CSS shapes, inline SVG icons and illustrated cards built from CSS. Use an image only when the user supplies one.
- Interaction: hover and focus states on every control, transitions of 150 to 250ms, buttons of one height and radius, contrast of at least 4.5:1 for text.
- Taste: one accent colour, neutrals for everything else, consistent radii, soft shadows at most (0 8px 24px rgba(0,0,0,.12)), no rainbow gradients, no emoji as icons, no centred walls of text.
- Apps: a clear shell (header, content, a sidebar if it earns its place), an empty state for every list, keyboard support for the main action, state kept in localStorage where it makes sense.

Ask before building: when the request is a new website or app from scratch and neither the request nor the brief below says anything about its purpose, look or sections, do not build yet. Reply with a <message> that asks at most three short questions (what it is for, the look they want, the sections or screens they need) and return no files. When a brief or any direction is given, build without asking.`;

/** The agent's instructions for this request. */
export function buildSystem(brief: Brief | undefined, _ask: string, files: Record<string, string> = {}): string {
    if (!brief) return SYSTEM;
    const parts = [SYSTEM, `The person's brief, which you build to:\n${briefText(brief)}`];
    if (brief.goal !== 'improve' && brief.goal !== 'try') parts.push(designBrief(brief, hasKit(files)));
    return parts.join('\n\n');
}

/**
 * The kit added to a website or app project that does not have it yet, with
 * its stylesheet imported in main.jsx. Returns the files to add or change.
 */
export function kitChanges(brief: Brief | undefined, files: Record<string, string>): Record<string, string> {
    if (!usesKit(brief) || hasKit(files) || !('package.json' in files)) return {};
    const changes: Record<string, string> = { ...KIT_FILES };
    const main = ['src/main.jsx', 'src/main.tsx', 'src/main.js'].find((path) => path in files);
    if (main && !/kit\/kit\.css/.test(files[main]!)) {
        const lines = files[main]!.split('\n');
        const lastImport = lines.reduce((at, line, i) => (/^import\s/.test(line) ? i : at), -1);
        lines.splice(lastImport + 1, 0, "import './kit/kit.css';");
        changes[main] = lines.join('\n');
    }
    return changes;
}
