/**
 * Entry point for dist/ocr.js: reading text from images on this computer, with
 * Tesseract. Built on its own, like pdf.js, so none of it is loaded until an
 * image is actually attached.
 */

import { createWorker } from 'tesseract.js';

export interface OcrImage {
    name: string;
    bytes: Uint8Array;
}

export interface OcrPage {
    name: string;
    text: string;
    /** Tesseract's mean confidence, 0-100. */
    confidence: number;
}

export interface OcrOptions {
    /** The downloaded engine (tesseract-core-*.js). */
    corePath: string;
    /** The worker script run in a worker thread. */
    workerPath: string;
    /** Directory holding eng.traineddata. */
    dataDir: string;
    signal?: AbortSignal;
}

/** LSTM only: the neural engine, without the older character matcher. */
const LSTM_ONLY = 1;

export async function readImages(images: readonly OcrImage[], options: OcrOptions): Promise<OcrPage[]> {
    // The worker thread inherits this; the shim in the bundle reads it to find
    // the engine that was downloaded at first use.
    process.env.FREEAGENTCODER_OCR_CORE = options.corePath;
    const worker = await createWorker('eng', LSTM_ONLY, {
        workerPath: options.workerPath,
        langPath: options.dataDir,
        cachePath: options.dataDir,
        cacheMethod: 'readOnly',
        gzip: false,
        legacyCore: false,
        legacyLang: false,
    });
    try {
        // Keeps the spacing of code and terminal output roughly intact.
        await worker.setParameters({ preserve_interword_spaces: '1' });
        const pages: OcrPage[] = [];
        for (const image of images) {
            options.signal?.throwIfAborted();
            const { data } = await worker.recognize(Buffer.from(image.bytes), {}, { text: true });
            pages.push({ name: image.name, text: (data.text ?? '').trim(), confidence: Math.round(data.confidence ?? 0) });
        }
        return pages;
    } finally {
        await worker.terminate().catch(() => undefined);
    }
}
