import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { gunzipSync } from 'fflate';
import type { OcrImage, OcrOptions, OcrPage } from './ocr-engine';

/**
 * Reading text from screenshots on this computer, with no API request and no
 * model. Most attached images are a screenshot of an error, a terminal or some
 * code, and their text is what the agent needs; reading it here keeps the
 * user's free API quota for the coding work itself.
 *
 * The engine is not shipped with the extension. It is downloaded once, from
 * pinned URLs and verified against pinned hashes, and then used from disk,
 * offline, forever.
 */

interface Asset {
    file: string;
    url: string;
    sha256: string;
    /** Unpacked after download (the language data ships gzipped). */
    gunzipTo?: string;
    bytes: number;
}

const ASSETS: Asset[] = [
    {
        file: 'tesseract-core-simd-lstm.js',
        url: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core-simd-lstm.js',
        sha256: 'e48e2f02ddae3716c8dd24bf41cd290d4efa96892d689cdc4013c2545d63f469',
        bytes: 97_000,
    },
    {
        file: 'tesseract-core-simd-lstm.wasm',
        url: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core-simd-lstm.wasm',
        sha256: '34e8d50cac216427d86bf397d610fdd9f49492539bbcdfbfccc4eda20c810bea',
        bytes: 2_863_000,
    },
    {
        file: 'eng.traineddata.gz',
        url: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz',
        sha256: '45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91',
        gunzipTo: 'eng.traineddata',
        bytes: 2_957_000,
    },
];

const CORE_FILE = 'tesseract-core-simd-lstm.js';
/** What the first use downloads, for the message shown before it starts. */
export const DOWNLOAD_SIZE = '5.7 MB';
const DOWNLOAD_TIMEOUT_MS = 120_000;

/** Below these, the reading is treated as too poor to use and a vision model is asked instead. */
const MIN_CONFIDENCE = 60;
const MIN_CHARS = 24;

export interface LocalReadOptions {
    /** Where the engine is kept: the extension's global storage. */
    dir: string;
    progress?: (message: string) => void;
    signal?: AbortSignal;
}

/** File extensions a reader often splits off with a stray space: "App. tsx". */
const EXTENSIONS = /\.\s+(tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|swift|rb|php|cs|cpp|cc|hpp?|json|jsonc|md|mdx|css|scss|html?|ya?ml|toml|ini|sh|sql|vue|svelte|prisma|env)\b/g;

/**
 * Small, safe repairs to what the reader returned. Tesseract turns straight
 * quotes into typographic ones and puts a space before a file extension often
 * enough to be worth fixing; nothing here changes a word or a name.
 */
export function tidy(text: string): string {
    return text
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/\u00A0/g, ' ')
        .replace(EXTENSIONS, '.$1')
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function isUsable(page: OcrPage): boolean {
    return page.text.replace(/\s+/g, '').length >= MIN_CHARS && page.confidence >= MIN_CONFIDENCE;
}

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

async function verified(file: string, expected: string): Promise<boolean> {
    try {
        return sha256(await fs.readFile(file)) === expected;
    } catch {
        return false;
    }
}

async function download(asset: Asset, dir: string, signal?: AbortSignal): Promise<void> {
    const timeout = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
    const response = await fetch(asset.url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) {
        throw new Error(`couldn't download the text reader (HTTP ${response.status})`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const got = sha256(bytes);
    if (got !== asset.sha256) {
        // Refuse to run code that isn't byte for byte what was pinned here.
        throw new Error(`the downloaded ${asset.file} did not match its expected checksum, so it was discarded`);
    }
    await fs.writeFile(path.join(dir, asset.file), bytes);
    if (asset.gunzipTo) {
        await fs.writeFile(path.join(dir, asset.gunzipTo), gunzipSync(bytes));
        await fs.rm(path.join(dir, asset.file), { force: true });
    }
}

let ready: Promise<string> | undefined;

/**
 * Makes sure the engine is on disk and returns the path of its core. Downloads
 * happen once per machine; afterwards this is a few checksums.
 */
export function ensureEngine(options: LocalReadOptions): Promise<string> {
    ready ??= install(options).catch((error: unknown) => {
        ready = undefined;
        throw error;
    });
    return ready;
}

async function install(options: LocalReadOptions): Promise<string> {
    const { dir } = options;
    await fs.mkdir(dir, { recursive: true });
    const missing: Asset[] = [];
    for (const asset of ASSETS) {
        const onDisk = asset.gunzipTo ? path.join(dir, asset.gunzipTo) : path.join(dir, asset.file);
        // The unpacked language data can't be checked against the hash of the
        // archive it came from, so its presence is enough.
        const ok = asset.gunzipTo ? existsSync(onDisk) : await verified(onDisk, asset.sha256);
        if (!ok) {
            missing.push(asset);
        }
    }
    if (missing.length) {
        const total = missing.reduce((sum, asset) => sum + asset.bytes, 0);
        options.progress?.(`Downloading the text reader (${(total / 1_000_000).toFixed(1)} MB, once) so images can be read here without using your API quota…`);
        for (const asset of missing) {
            await download(asset, dir, options.signal);
        }
    }
    return path.join(dir, CORE_FILE);
}

type Engine = typeof import('./ocr-engine');

/**
 * dist/ocr.js and dist/ocr-worker.js are built next to extension.js. Outside
 * the build (tests, scripts) the package in node_modules is used instead, so
 * the same code path can be run without packaging.
 */
async function loadEngine(): Promise<{ engine: Engine; workerPath: string; corePath?: string }> {
    const bundled = path.join(__dirname, 'ocr.js');
    const worker = path.join(__dirname, 'ocr-worker.js');
    if (existsSync(bundled) && existsSync(worker)) {
        return { engine: createRequire(__filename)(bundled) as Engine, workerPath: worker };
    }
    const require_ = createRequire(__filename);
    return {
        engine: (await import('./ocr-engine')) as Engine,
        workerPath: require_.resolve('tesseract.js/src/worker-script/node/index.js'),
        corePath: require_.resolve(`tesseract.js-core/${CORE_FILE}`),
    };
}

/** Reads every image on this computer. Throws if the engine can't be set up. */
export async function readImagesLocally(images: readonly OcrImage[], options: LocalReadOptions): Promise<OcrPage[]> {
    const [{ engine, workerPath, corePath }, downloaded] = await Promise.all([loadEngine(), ensureEngine(options)]);
    const settings: OcrOptions = { corePath: corePath ?? downloaded, workerPath, dataDir: options.dir, signal: options.signal };
    const pages = await engine.readImages(images, settings);
    return pages.map((page) => ({ ...page, text: tidy(page.text) }));
}

export type { OcrImage, OcrPage };
