import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { ImagePart } from '@agentic/core';
import { compactNumber, errorMessage } from '../shared/format';
import type { AttachmentInput, AttachmentView } from '../shared/protocol';
import { extractDocument } from './extract';
import type { ReadResult } from './reader';

export const MAX_ATTACHMENTS = 10;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 30 * 1024 * 1024;
/** Gemini accepts inline requests up to 20 MB, and base64 adds a third. */
const MAX_INLINE_PDF_BYTES = 14 * 1024 * 1024;
/** Characters of attachment text put straight into the prompt; the rest is saved to files the agent can read. */
const INLINE_BUDGET = 30_000;
const PREVIEW_CHARS = 3_000;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export const ATTACHMENTS_DIR = '.freeagentcoder/attachments';

export interface AttachmentReaders {
    images?: (images: ImagePart[], signal: AbortSignal) => Promise<ReadResult>;
    scannedPdf?: (bytes: Uint8Array, name: string, signal: AbortSignal) => Promise<ReadResult>;
    digest?: (name: string, text: string, signal: AbortSignal) => Promise<ReadResult>;
}

export interface PreparedAttachments {
    /** Markdown added to the agent's prompt. */
    block: string;
    images: ImagePart[];
    notes: string[];
    /** What the attachments showed, for learning from corrections. */
    evidence: string;
}

export function attachmentViews(inputs: AttachmentInput[]): AttachmentView[] {
    return inputs.slice(0, MAX_ATTACHMENTS).map((a) => ({
        name: String(a.name).slice(0, 120),
        kind: a.kind,
        size: Number(a.size) || 0,
        thumb: a.kind === 'image' && typeof a.thumb === 'string' && a.thumb.startsWith('data:image/') && a.thumb.length < 60_000 ? a.thumb : undefined,
    }));
}

function safeName(name: string): string {
    return name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '-').slice(-80) || 'attachment';
}

function stamp(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Saves an attachment under .freeagentcoder/ (git-ignored) so the agent can read or copy it. */
async function saveFile(cwd: string, name: string, data: string | Uint8Array): Promise<string> {
    await fs.mkdir(path.join(cwd, ATTACHMENTS_DIR), { recursive: true });
    await fs.writeFile(path.join(cwd, '.freeagentcoder', '.gitignore'), '# Files attached in FreeAgentCoder chats. Not part of your project.\n*\n', { flag: 'wx' }).catch(() => undefined);
    const rel = `${ATTACHMENTS_DIR}/${stamp()}-${safeName(name)}`;
    await fs.writeFile(path.join(cwd, rel), data);
    return rel;
}

/**
 * Turns attachments into what the agent needs: document text (extracted
 * locally), image parts for models that can see, a vision model's reading of
 * screenshots and scanned PDFs, and saved files for anything too long to
 * include in full.
 */
export async function prepareAttachments(
    inputs: AttachmentInput[],
    opts: { cwd: string; signal: AbortSignal; readers: AttachmentReaders; progress: (message: string) => void },
): Promise<PreparedAttachments> {
    const notes: string[] = [];
    const images: ImagePart[] = [];
    const listed: string[] = [];
    const texts: { name: string; kind: string; text: string; detail?: string }[] = [];
    const failed = (name: string, error: unknown) => {
        if (opts.signal.aborted) {
            throw error;
        }
        notes.push(`Couldn't read ${name}: ${errorMessage(error).replace(/^\w+:\s*/, '').slice(0, 160)}`);
        return undefined;
    };

    if (inputs.length > MAX_ATTACHMENTS) {
        notes.push(`Only the first ${MAX_ATTACHMENTS} attachments were used.`);
    }

    for (const input of inputs.slice(0, MAX_ATTACHMENTS)) {
        const name = String(input.name || 'attachment').slice(0, 120);
        if (input.kind === 'text') {
            texts.push({ name, kind: 'pasted text', text: String(input.data), detail: `${String(input.data).split('\n').length} lines` });
            continue;
        }
        const bytes = Buffer.from(String(input.data), 'base64');
        if (input.kind === 'image') {
            if (!IMAGE_TYPES.has(input.mimeType)) {
                notes.push(`${name}: this image type isn't supported. Use PNG, JPEG, WebP or GIF.`);
            } else if (bytes.length > MAX_IMAGE_BYTES) {
                notes.push(`${name} is larger than 10 MB, so it was skipped.`);
            } else {
                const saved = await saveFile(opts.cwd, name, bytes);
                images.push({ mimeType: input.mimeType as ImagePart['mimeType'], data: bytes.toString('base64'), name });
                listed.push(`- Image ${images.length}: \`${name}\`, saved at \`${saved}\` (copy it into the project if the user wants to use it)`);
            }
            continue;
        }
        if (bytes.length > MAX_DOCUMENT_BYTES) {
            notes.push(`${name} is larger than 30 MB, so it was skipped.`);
            continue;
        }
        const result = await extractDocument(bytes, name, input.mimeType);
        if (result.kind === 'text') {
            texts.push({ name, kind: result.format.toUpperCase(), text: result.text, detail: result.pages ? `${result.pages} pages` : undefined });
            if (result.truncated) {
                notes.push(`${name} is very long, so only its first part was read.`);
            }
        } else if (result.kind === 'needs-vision') {
            const saved = await saveFile(opts.cwd, name, bytes);
            if (!opts.readers.scannedPdf) {
                notes.push(`${name} has no text layer (it looks scanned). Add a Gemini key and turn on "Read attachments" so a vision model can read it. It was saved at ${saved}.`);
            } else if (bytes.length > MAX_INLINE_PDF_BYTES) {
                notes.push(`${name} is a scanned PDF over 14 MB, too large to send to a vision model. Split it into smaller files.`);
            } else {
                opts.progress(`Reading ${name} (scanned PDF) with a vision model…`);
                const read = await opts.readers.scannedPdf(bytes, name, opts.signal).catch((error: unknown) => failed(name, error));
                if (read?.text) {
                    texts.push({ name, kind: 'PDF read by a vision model', text: read.text, detail: result.pages ? `${result.pages} pages` : undefined });
                }
            }
        } else {
            notes.push(`${name}: ${result.reason}`);
        }
    }

    const sections: string[] = [];
    if (listed.length) {
        sections.push(`### Images\n${listed.join('\n')}`);
    }
    let evidence = '';
    if (images.length && opts.readers.images) {
        opts.progress(`Reading ${images.length === 1 ? 'the image' : `${images.length} images`} with a vision model…`);
        const read = await opts.readers.images(images, opts.signal).catch((error: unknown) => failed(images.length === 1 ? 'the image' : 'the images', error));
        if (read?.text) {
            evidence = read.text;
            sections.push(`### What the image${images.length === 1 ? ' shows' : 's show'} (read by ${read.model ?? 'a vision model'})\n${read.text}`);
        }
    }

    let budget = INLINE_BUDGET;
    for (const item of texts) {
        const header = `### ${item.name} (${item.kind}${item.detail ? `, ${item.detail}` : ''})`;
        if (item.text.length <= budget) {
            budget -= item.text.length;
            sections.push(`${header}\n<attachment name="${item.name.replace(/"/g, "'")}">\n${item.text}\n</attachment>`);
            continue;
        }
        const saved = await saveFile(opts.cwd, `${item.name.replace(/\.[^.]+$/, '')}.md`, item.text);
        let summary: string | undefined;
        if (opts.readers.digest) {
            opts.progress(`Summarizing ${item.name} (${compactNumber(item.text.length)} characters)…`);
            summary = (await opts.readers.digest(item.name, item.text, opts.signal).catch((error: unknown) => failed(item.name, error)))?.text;
        }
        sections.push(
            `${header}\nToo long to include in full (${item.text.length.toLocaleString('en-US')} characters). The full text is saved at \`${saved}\`: read the parts you need with read_file (offset and limit) or grep.\n${
                summary ? `Summary:\n${summary}` : `Beginning:\n<attachment-preview>\n${item.text.slice(0, PREVIEW_CHARS)}\n</attachment-preview>`
            }`,
        );
    }
    if (!evidence && texts.length) {
        evidence = texts.map((t) => `${t.name}: ${t.text.slice(0, 600)}`).join('\n');
    }

    return {
        block: sections.length ? `## Attached by the user\n${sections.join('\n\n')}` : '',
        images,
        notes,
        evidence,
    };
}
