import { modelSupportsImages } from '@agentic/core';
import type { KeyRef, RouteStep } from './catalog';

/** Models that read screenshots and scanned documents well, strongest free option first. */
const VISION_MODELS: [provider: string, model: string][] = [
    ['gemini', 'gemini-3.8-flash'],
    ['mistral', 'mistral-medium-latest'],
    ['openai', 'gpt-5-mini'],
    ['anthropic', 'claude-haiku-4-5'],
];

/** The chain for the attachment reader: only keys whose model can see images. */
export function planVisionRoute<K extends KeyRef>(keys: K[], load: (keyId: string) => number): RouteStep<K>[] {
    const steps: RouteStep<K>[] = [];
    for (const [provider, model] of VISION_MODELS) {
        const list = keys.filter((k) => k.provider === provider).sort((a, b) => load(a.id) - load(b.id));
        if (list.length && modelSupportsImages(provider, model)) {
            steps.push({ provider, model, keys: list });
        }
    }
    return steps;
}

/** The Gemini model used to read PDFs natively. */
export const PDF_READER_MODEL = 'gemini-3.8-flash';
