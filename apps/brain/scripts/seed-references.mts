/**
 * Condenses reference projects into the reference library's built-in seed,
 * with the same reader and prompt the admin page uses. Not shipped.
 *
 *   GEMINI_API_KEY=… node --conditions=react-server --import tsx scripts/seed-references.mts
 */
import { writeFile } from 'node:fs/promises';
import { ModelRouter, PRESETS, createProvider } from '@agentic/core';
import { CONDENSE_SYSTEM, completeText, condensePrompt, parseCondensed, readSource, slug, type Reference, type ReferenceKind } from '../lib/references';

const SOURCES: { input: string; kind: ReferenceKind }[] = [
    { input: 'https://github.com/SkAshraf16/SmartSales', kind: 'blueprint' },
    { input: 'https://github.com/Prateek22672/veecos', kind: 'design' },
    { input: 'https://github.com/Prateek22672/foliofyx', kind: 'design' },
    { input: 'https://github.com/Prateek22672/hireview', kind: 'design' },
    { input: 'https://github.com/Prateek22672/Forterra-Developers', kind: 'design' },
    { input: 'https://github.com/Prateek22672/krisha-ai', kind: 'design' },
    { input: 'https://github.com/Prateek22672/smart-parking-system', kind: 'design' },
    { input: 'https://github.com/Prateek22672/voice-ai-platform', kind: 'design' },
];

const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error('Set GEMINI_API_KEY');
const preset = PRESETS.gemini!;
const router = new ModelRouter(
    ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash'].map((model) => ({
        provider: createProvider(preset, { apiKey: key }),
        model,
        contextWindow: preset.contextWindow,
    })),
);

const out: Reference[] = [];
for (const { input, kind } of SOURCES) {
    try {
        const source = await readSource(input);
        const reply = await completeText(router, CONDENSE_SYSTEM, condensePrompt(kind, source.title, source.text), AbortSignal.timeout(180_000));
        const condensed = parseCondensed(reply);
        if (!condensed) {
            console.log('NO JSON', input, reply.slice(0, 300));
            continue;
        }
        out.push({ id: slug(condensed.name), kind, name: condensed.name, tags: condensed.tags, points: condensed.points, source: input, addedAt: Date.now(), enabled: true });
        console.log('ok', kind, condensed.name, `${condensed.points.length} rules`, `${source.text.length} chars read`);
    } catch (error) {
        console.log('FAILED', input, error instanceof Error ? error.message : error);
    }
}
await writeFile(process.argv[2] ?? 'references-seed.json', JSON.stringify(out, null, 2));
