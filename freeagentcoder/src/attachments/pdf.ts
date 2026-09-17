/** PDF text-layer extraction via unpdf's serverless pdf.js build (no worker file needed). */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

type PdfJsModule = Pick<typeof import('unpdf'), 'getResolvedPDFJS'>;

/**
 * pdf.js is most of the extension's size, so the build puts it in its own
 * dist/pdf.js next to extension.js: it is read only when a PDF is attached,
 * which keeps opening the panel fast. Outside the build (tests, scripts) the
 * package is loaded directly.
 */
async function loadPdfJs(): Promise<PdfJsModule> {
    const bundled = path.join(__dirname, 'pdf.js');
    if (existsSync(bundled)) {
        return createRequire(__filename)(bundled) as PdfJsModule;
    }
    return import('unpdf');
}

export type PdfExtract =
    | { kind: 'text'; text: string; pages: number; pagesRead: number; stoppedEarly: boolean; failedPages: number[] }
    | { kind: 'needs-vision'; reason: string; pages: number }
    | { kind: 'unsupported'; reason: string };

interface PdfTextItem {
    str: string;
    hasEOL?: boolean;
    transform: number[];
    width: number;
    height: number;
}

/** Below this many non-space characters per page on average the PDF is treated as scanned. */
const MIN_CHARS_PER_PAGE = 40;

export async function extractPdf(bytes: Uint8Array, maxChars: number): Promise<PdfExtract> {
    const { getResolvedPDFJS } = await loadPdfJs();
    const pdfjs = await getResolvedPDFJS();
    const task = pdfjs.getDocument({
        data: bytes.slice(), // pdf.js may take ownership of the buffer
        verbosity: 0,
        useSystemFonts: false,
        disableFontFace: true,
        stopAtErrors: false,
    });
    try {
        let doc;
        try {
            doc = await task.promise;
        } catch (error) {
            const name = (error as { name?: string } | undefined)?.name;
            if (name === 'PasswordException') {
                return { kind: 'unsupported', reason: 'This PDF is password-protected. Remove the password and attach it again.' };
            }
            if (name === 'InvalidPDFException' || name === 'FormatError') {
                return { kind: 'unsupported', reason: 'This file is not a valid PDF or is damaged.' };
            }
            return { kind: 'unsupported', reason: `This PDF could not be opened (${errorMessage(error)}).` };
        }

        const pages = doc.numPages;
        if (pages === 0) {
            return { kind: 'unsupported', reason: 'This PDF has no pages.' };
        }
        const parts: string[] = [];
        const failedPages: number[] = [];
        let total = 0;
        let nonSpace = 0;
        let pagesRead = 0;
        for (let n = 1; n <= pages; n++) {
            let pageText = '';
            try {
                const page = await doc.getPage(n);
                const content = await page.getTextContent();
                pageText = itemsToText(content.items as unknown as PdfTextItem[]);
                page.cleanup();
            } catch {
                failedPages.push(n);
            }
            pagesRead = n;
            nonSpace += pageText.replace(/\s+/g, '').length;
            const part = `--- Page ${n} ---\n${pageText}`;
            parts.push(part);
            total += part.length + 2;
            if (total > maxChars) {
                break;
            }
        }

        if (nonSpace / pagesRead < MIN_CHARS_PER_PAGE) {
            return {
                kind: 'needs-vision',
                pages,
                reason: nonSpace === 0
                    ? 'This PDF has no text layer (it looks like a scanned or image-only document).'
                    : 'This PDF has almost no extractable text (it looks like a scanned or image-only document).',
            };
        }
        return { kind: 'text', text: parts.join('\n\n'), pages, pagesRead, stoppedEarly: pagesRead < pages, failedPages };
    } finally {
        await task.destroy().catch(() => undefined);
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Rebuild lines from pdf.js text items (content-stream order), then repair hyphenated line breaks. */
function itemsToText(items: PdfTextItem[]): string {
    const lines: string[] = [];
    let line = '';
    let lastY: number | undefined;
    let lastXEnd: number | undefined;
    let lastHeight = 0;

    const endLine = () => {
        lines.push(line.trimEnd());
        line = '';
        lastXEnd = undefined;
    };

    for (const item of items) {
        if (typeof item.str !== 'string') {
            continue; // marked-content entries
        }
        const [, , , , x, y] = item.transform;
        const height = Math.abs(item.height) || Math.abs(item.transform[3]) || lastHeight || 10;
        if (item.str.trim().length > 0 || line.length > 0) {
            if (line.length > 0 && lastY !== undefined && Math.abs(y - lastY) > Math.max(2, Math.min(height, lastHeight || height) * 0.5)) {
                endLine();
            }
            if (line.length === 0 && lastY !== undefined && lines.length > 0 && lines[lines.length - 1] !== ''
                && y < lastY && lastY - y > Math.max(height, lastHeight) * 1.9) {
                // A downward jump well beyond one line height starts a new paragraph.
                lines.push('');
            }
            if (line.length > 0 && lastXEnd !== undefined && x - lastXEnd > height * 0.15
                && !/\s$/.test(line) && !/^\s/.test(item.str)) {
                line += ' ';
            }
            line += item.str;
            lastY = y;
            lastHeight = height;
            lastXEnd = x + item.width;
        }
        if (item.hasEOL && line.length > 0) {
            endLine();
        }
    }
    if (line.length > 0) {
        endLine();
    }

    return lines
        .join('\n')
        .replace(/[ \t]+/g, ' ')
        // "exam-\nple" -> "example" when the next line continues in lowercase; soft hyphens always join.
        .replace(/(\p{L})[-­]\n(?=\p{Ll})/gu, '$1')
        .replace(/­\n/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
