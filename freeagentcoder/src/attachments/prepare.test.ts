import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AttachmentInput } from '../shared/protocol';
import { prepareAttachments } from './prepare';

let cwd: string;
beforeAll(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), 'fac-attach-'));
});
afterAll(async () => {
    await rm(cwd, { recursive: true, force: true });
});

/** A 1x1 PNG, enough to be treated as a real image. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const image = (name = 'screenshot.png'): AttachmentInput => ({ name, kind: 'image', mimeType: 'image/png', size: 70, data: PNG });
const run = (inputs: AttachmentInput[], readers: Parameters<typeof prepareAttachments>[1]['readers']) =>
    prepareAttachments(inputs, { cwd, signal: new AbortController().signal, readers, progress: () => {} });

describe('an image that could not be read', () => {
    it('tells the model so, instead of leaving it a file name to guess from', async () => {
        const prepared = await run([image()], { images: () => Promise.reject(new Error('gemini: model is overloaded')) });
        expect(prepared.block).toContain('could not be read');
        expect(prepared.block).toMatch(/Do not describe, summarize or guess/);
        expect(prepared.notes.join(' ')).toContain('overloaded');
        expect(prepared.evidence).toBe('');
    });

    it('says the same when no vision reader is available at all', async () => {
        const prepared = await run([image()], {});
        expect(prepared.block).toContain('could not be read');
    });

    it('says nothing of the sort once an image has been read', async () => {
        const prepared = await run([image()], { images: () => Promise.resolve({ text: 'A billing page with a Stripe error.', model: 'gemini:gemini-3.8-flash' }) });
        expect(prepared.block).toContain('A billing page with a Stripe error.');
        expect(prepared.block).not.toContain('could not be read');
        expect(prepared.evidence).toBe('A billing page with a Stripe error.');
    });

    it('uses plural wording for several images', async () => {
        const prepared = await run([image('a.png'), image('b.png')], {});
        expect(prepared.block).toContain('These images could not be read');
        expect(prepared.block).toContain('their contents');
    });
});

const page = (text: string, confidence = 85, name = 'screenshot.png') => ({ name, text, confidence });
const READ = 'TS2345: Argument of type string | undefined is not assignable';

describe('reading images on this computer first', () => {
    it('uses what it read here and never asks a vision model', async () => {
        let visionCalls = 0;
        const progress: string[] = [];
        const prepared = await prepareAttachments([image()], {
            cwd,
            signal: new AbortController().signal,
            progress: (message) => progress.push(message),
            readers: {
                localImages: () => Promise.resolve([page(READ)]),
                images: () => {
                    visionCalls += 1;
                    return Promise.resolve({ text: 'never asked', model: 'gemini' });
                },
            },
        });
        expect(visionCalls).toBe(0);
        expect(prepared.block).toContain(READ);
        expect(prepared.block).toContain('Text read from the image on this computer');
        expect(prepared.block).toMatch(/treat every name here as approximate/);
        expect(prepared.evidence).toContain(READ);
        expect(progress.join(' ')).toContain('without an API request');
    });

    it('asks a vision model when the reading here is too poor to trust', async () => {
        const prepared = await run([image()], {
            localImages: () => Promise.resolve([page('BF', 30)]),
            images: () => Promise.resolve({ text: 'A billing form with a red error.', model: 'gemini:flash' }),
        });
        expect(prepared.block).toContain('A billing form with a red error.');
        expect(prepared.block).not.toContain('on this computer');
    });

    it('asks a vision model when the reader here fails outright', async () => {
        const prepared = await run([image()], {
            localImages: () => Promise.reject(new Error('engine download failed')),
            images: () => Promise.resolve({ text: 'A billing form.', model: 'gemini:flash' }),
        });
        expect(prepared.block).toContain('A billing form.');
    });

    it('keeps the part it did read when no vision model can be reached', async () => {
        const prepared = await run([image('a.png'), image('b.png')], {
            localImages: () => Promise.resolve([page(READ, 80, 'a.png'), page('~', 12, 'b.png')]),
        });
        expect(prepared.block).toContain(READ);
        expect(prepared.block).toContain('No vision model could be reached');
        expect(prepared.block).not.toContain('confidence 12%');
    });

    it('still says an image could not be read when nothing read it', async () => {
        const prepared = await run([image()], { localImages: () => Promise.resolve([page('', 0)]) });
        expect(prepared.block).toContain('could not be read');
    });
});
