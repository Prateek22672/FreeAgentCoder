/**
 * Builds one site the way Fyxable does — same system prompt, brief and
 * project context — on a model reachable from this computer, then writes the
 * files into a scratch folder. Not shipped; for judging the design library.
 *
 *   npx tsx scripts/design-eval.mts <out-dir> <brief.json>
 *
 * The model is the extension's free-trial endpoint unless EVAL_GEMINI_KEY is set.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { ModelRouter, OpenAICompatProvider, PRESETS, createProvider } from '@agentic/core';
import { firstRequest, readBrief, starterFor } from '../lib/brief';
import { parseEdit } from '../lib/playgroundEdits';
import { STARTERS, starterById } from '../lib/starters';
import { buildSystem, kitChanges, projectContext } from '../lib/playgroundPrompt';
import { pickDirection, pickRecipe } from '../lib/design';

const [outDir, briefFile] = process.argv.slice(2);
if (!outDir || !briefFile) throw new Error('usage: design-eval.mts <out-dir> <brief.json>');
const brief = readBrief(JSON.parse(await readFile(briefFile, 'utf8')));
if (!brief) throw new Error('not a brief');

const gemini = process.env.EVAL_GEMINI_KEY;
const provider = gemini
    ? createProvider(PRESETS.gemini!, { apiKey: gemini, maxOutputTokens: 16_384 })
    : new OpenAICompatProvider({ id: 'trial', baseURL: 'https://brain-rho-roan.vercel.app/api/trial/v1', apiKey: `fact_${randomUUID()}`, thoughtSignatures: true, maxOutputTokens: 8_192 });
const router = new ModelRouter([{ provider, model: gemini ? PRESETS.gemini!.defaultModel : 'deep', contextWindow: 128_000 }]);

const starter = starterById(starterFor(brief)) ?? STARTERS[0]!;
const files: Record<string, string> = { ...starter.files };
const ask = firstRequest(brief) ?? brief.idea;
Object.assign(files, kitChanges(brief, files));
const system = buildSystem(brief, ask, files);
console.log(`direction: ${pickDirection(brief).name} · recipe: ${pickRecipe(brief).name}`);
console.log(`system prompt: ~${Math.round(system.length / 4)} tokens`);

const messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: `The project now:\n${projectContext(files, ask)}\n\nRequest: ${ask}` }];
let text = '';
const started = Date.now();
for (let call = 0; call < 3; call++) {
    const stream = router.stream({ system, messages, tools: [], temperature: 0.2 });
    let step = await stream.next();
    while (!step.done) step = await stream.next();
    text += step.value.content;
    console.log(`call ${call + 1}: ${step.value.model} · stop ${step.value.stop} · ${step.value.content.length} chars · ${Math.round((Date.now() - started) / 1000)}s`);
    if (step.value.stop !== 'max_tokens') break;
    messages.push(
        { role: 'assistant', content: step.value.content },
        { role: 'user', content: 'Your reply was cut off by the output limit. Continue exactly where it stopped, from the next character: no repetition, no preamble, and close every tag you open.' },
    );
}
const edit = parseEdit(text);
for (const file of edit.files) files[file.path] = file.content;
for (const gone of edit.deletes) delete files[gone];
for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(outDir, file)), { recursive: true });
    await writeFile(path.join(outDir, file), content);
}
await writeFile(path.join(outDir, '_reply.txt'), text);
console.log(`message: ${edit.message}`);
console.log(`files: ${edit.files.map((f) => `${f.path} (${f.content.length})`).join(', ')}`);
process.exit(0);
