/**
 * Turns attached / pasted documents into plain text the coding agent can read.
 * Self-contained: PDF via unpdf (pdf.js), Office Open XML via fflate + a light
 * XML walk, and text-like files via built-in decoders.
 */

import { extractOoxml, isZip, type OoxmlFormat } from './ooxml';
import { extractPdf } from './pdf';
import { decodeText, htmlToText, rtfToText } from './text';

export type ExtractResult =
    | { kind: 'text'; format: string; text: string; pages?: number; truncated: boolean; note?: string }
    | { kind: 'needs-vision'; format: 'pdf'; reason: string; pages?: number } // e.g. scanned PDF without a text layer
    | { kind: 'unsupported'; reason: string };

const DEFAULT_MAX_CHARS = 400_000;

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

const OFFICE_EXTENSIONS = ['.pdf', '.docx', '.pptx', '.xlsx'];

const TEXT_EXTENSIONS = [
    '.txt', '.text', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.yaml', '.yml', '.xml', '.html', '.htm',
    '.rtf', '.log', '.ini', '.cfg', '.conf', '.toml', '.env', '.properties', '.rst', '.adoc', '.tex', '.srt', '.vtt',
    // Common source files
    '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.py', '.ipynb', '.java', '.kt', '.kts', '.scala',
    '.groovy', '.gradle', '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.cs', '.fs', '.go', '.rs', '.rb', '.php',
    '.swift', '.m', '.mm', '.dart', '.lua', '.r', '.pl', '.pm', '.ex', '.exs', '.erl', '.hs', '.clj', '.ml', '.elm',
    '.jl', '.zig', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1', '.bat', '.cmd', '.sql', '.graphql', '.gql',
    '.proto', '.css', '.scss', '.sass', '.less', '.vue', '.svelte', '.astro', '.tf', '.hcl', '.dockerfile',
    '.diff', '.patch', '.lock',
];

const TEXT_BASENAMES = new Set(['dockerfile', 'makefile', 'license', 'readme', 'changelog', 'gemfile', 'procfile', '.gitignore', '.env', '.editorconfig']);

export const DOCUMENT_EXTENSIONS: readonly string[] = Object.freeze([...OFFICE_EXTENSIONS, ...TEXT_EXTENSIONS]);

const MIME_FORMATS: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'text/html': 'html',
    'application/xhtml+xml': 'html',
    'text/rtf': 'rtf',
    'application/rtf': 'rtf',
    'text/markdown': 'md',
    'text/csv': 'csv',
    'text/tab-separated-values': 'tsv',
    'application/json': 'json',
    'application/xml': 'xml',
    'text/xml': 'xml',
    'application/yaml': 'yaml',
    'application/x-yaml': 'yaml',
    'text/yaml': 'yaml',
    'application/javascript': 'js',
    'application/typescript': 'ts',
    'application/x-sh': 'sh',
    'application/sql': 'sql',
};

function extensionOf(name: string): string {
    const base = name.replace(/^.*[\\/]/, '');
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

function baseName(name: string): string {
    return name.replace(/^.*[\\/]/, '').toLowerCase();
}

function normalizeMime(mimeType?: string): string {
    return (mimeType ?? '').split(';')[0].trim().toLowerCase();
}

export function isImageFile(name: string, mimeType?: string): boolean {
    return IMAGE_EXTENSIONS.includes(extensionOf(name)) || IMAGE_MIME_TYPES.includes(normalizeMime(mimeType));
}

export function isDocumentFile(name: string, mimeType?: string): boolean {
    if (DOCUMENT_EXTENSIONS.includes(extensionOf(name)) || TEXT_BASENAMES.has(baseName(name))) {
        return true;
    }
    const mime = normalizeMime(mimeType);
    return mime in MIME_FORMATS || mime.startsWith('text/');
}

export async function extractDocument(
    bytes: Uint8Array,
    name: string,
    mimeType?: string,
    opts?: { maxChars?: number },
): Promise<ExtractResult> {
    const maxChars = Math.max(1, opts?.maxChars ?? DEFAULT_MAX_CHARS);
    const ext = extensionOf(name);
    const declared = ext ? ext.slice(1) : MIME_FORMATS[normalizeMime(mimeType)];
    try {
        if (bytes.length === 0) {
            return { kind: 'text', format: declared ?? 'text', text: '', truncated: false, note: 'The file is empty.' };
        }

        // Sniff content first: extensions and MIME types from pasted files are often wrong.
        if (isPdf(bytes) || (declared === 'pdf' && !isZip(bytes))) {
            return await fromPdf(bytes, maxChars);
        }
        if (isZip(bytes)) {
            const hint = (['docx', 'pptx', 'xlsx'] as const).find((f) => f === declared) as OoxmlFormat | undefined;
            const result = extractOoxml(bytes, hint);
            if (result.kind === 'unsupported') {
                return result;
            }
            return finish(result.format, result.text, maxChars, { pages: result.pages, note: result.note });
        }
        if (isOleCompound(bytes)) {
            return {
                kind: 'unsupported',
                reason: ['docx', 'pptx', 'xlsx'].includes(declared ?? '')
                    ? 'This Office file is password-protected (encrypted). Remove the password and attach it again.'
                    : 'Legacy Office formats (.doc, .xls, .ppt) are not supported. Save it as .docx, .xlsx or .pptx, or as PDF.',
            };
        }
        if (isImageFile(name, mimeType) || looksLikeImage(bytes)) {
            return { kind: 'unsupported', reason: 'This is an image, not a text document. Attach it as an image instead.' };
        }

        const decoded = decodeText(bytes);
        if (!decoded) {
            return { kind: 'unsupported', reason: `"${baseName(name) || 'This file'}" looks like a binary file, so no text could be extracted.` };
        }
        const format = declared ?? 'text';
        if (format === 'html' || format === 'htm' || (!ext && /^\s*<(!doctype html|html)\b/i.test(decoded.text))) {
            return finish('html', htmlToText(decoded.text), maxChars);
        }
        if (format === 'rtf' || decoded.text.startsWith('{\\rtf')) {
            return finish('rtf', rtfToText(decoded.text), maxChars);
        }
        const text = decoded.text.replace(/\r\n?/g, '\n');
        return finish(format === 'markdown' ? 'md' : format, text, maxChars);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { kind: 'unsupported', reason: `Could not read "${baseName(name)}": ${message}` };
    }
}

async function fromPdf(bytes: Uint8Array, maxChars: number): Promise<ExtractResult> {
    const result = await extractPdf(bytes, maxChars);
    if (result.kind === 'unsupported') {
        return result;
    }
    if (result.kind === 'needs-vision') {
        return { kind: 'needs-vision', format: 'pdf', reason: result.reason, pages: result.pages };
    }
    const notes: string[] = [];
    if (result.failedPages.length) {
        notes.push(`Some pages could not be read: ${result.failedPages.join(', ')}.`);
    }
    const out = finish('pdf', result.text, maxChars, { pages: result.pages, note: notes.join(' ') || undefined });
    if (out.kind === 'text' && result.stoppedEarly) {
        const note = `Truncated to ${maxChars.toLocaleString('en-US')} characters: read ${result.pagesRead} of ${result.pages} pages.`;
        return { ...out, truncated: true, note: [note, ...notes].join(' ') };
    }
    return out;
}

function finish(format: string, text: string, maxChars: number, extra: { pages?: number; note?: string } = {}): ExtractResult {
    let note = extra.note;
    let truncated = false;
    if (text.length > maxChars) {
        let cut = text.lastIndexOf('\n', maxChars);
        if (cut < maxChars * 0.9) {
            cut = maxChars;
        }
        // Do not split a surrogate pair.
        if (cut > 0 && /[\ud800-\udbff]/.test(text[cut - 1])) {
            cut--;
        }
        const truncNote = `Truncated to ${cut.toLocaleString('en-US')} of ${text.length.toLocaleString('en-US')} characters.`;
        text = text.slice(0, cut).trimEnd();
        truncated = true;
        note = note ? `${truncNote} ${note}` : truncNote;
    }
    if (!truncated && !text.trim() && !note) {
        note = 'No text was found in this document.';
    }
    const result: ExtractResult = { kind: 'text', format, text, truncated };
    if (extra.pages !== undefined) {
        result.pages = extra.pages;
    }
    if (note) {
        result.note = note;
    }
    return result;
}

function isPdf(bytes: Uint8Array): boolean {
    // The header may be preceded by junk; pdf.js tolerates up to ~1KB.
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
    return head.includes('%PDF-');
}

function isOleCompound(bytes: Uint8Array): boolean {
    return bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

function looksLikeImage(bytes: Uint8Array): boolean {
    const b = bytes;
    return (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) // PNG
        || (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) // JPEG
        || (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) // GIF
        || (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50); // WEBP
}
