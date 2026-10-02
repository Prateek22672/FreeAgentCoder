import { failFrom, fail, json, readBody } from '@/lib/http';
import { loadBrain } from '@/lib/store';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Brings a public GitHub repository into Fyxable: reads it with Project Brain
 * (read-only, nothing run), and returns its text files with a short map of
 * the project, so the agent starts out knowing how it is built. One request,
 * because analyses live in one server's memory.
 */
const MAX_FILES = 400;
const MAX_TOTAL = 2_500_000;
const MAX_FILE = 200_000;
/** Generated or bulky files the agent never needs and the browser need not hold. */
const SKIP = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|\.DS_Store)$|\.(min\.js|map|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|mp4|pdf|zip)$/i;

export async function POST(request: Request) {
    const body = await readBody<{ repo?: string }>(request);
    if (!body?.repo || typeof body.repo !== 'string' || body.repo.length > 300) return fail('Enter a GitHub repository, like owner/name.');
    try {
        const brain = await loadBrain(body.repo);
        const files: Record<string, string> = {};
        let total = 0;
        let left = 0;
        for (const [path, file] of brain.byPath) {
            const text = file.text;
            if (typeof text !== 'string' || SKIP.test(path) || text.length > MAX_FILE) {
                left++;
                continue;
            }
            if (Object.keys(files).length >= MAX_FILES || total + text.length > MAX_TOTAL) {
                left++;
                continue;
            }
            files[path] = text;
            total += text.length;
        }
        if (!Object.keys(files).length) return fail('That repository has no text files Fyxable can open.', 422);
        const a = brain.analysis;
        const stack = [...a.frameworks.map((f) => f.value), ...a.languages.slice(0, 3).map((l) => l.name)].filter((v, i, all) => all.indexOf(v) === i).slice(0, 6);
        return json({
            name: `${a.meta.owner}/${a.meta.repo}`,
            files,
            left,
            map: {
                stack,
                packageManager: a.packageManager?.value,
                layers: a.architecture.map((l) => ({ label: l.label, files: l.files, examples: l.examples.slice(0, 3) })),
                important: a.importantFiles.slice(0, 8),
                runnable: 'package.json' in files,
            },
        });
    } catch (error) {
        return failFrom(error);
    }
}
