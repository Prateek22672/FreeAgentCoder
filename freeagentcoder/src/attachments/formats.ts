/**
 * Readers for the formats beyond PDF and Office Open XML: OpenDocument
 * (.odt .ods .odp, what LibreOffice and Google Docs export), EPUB, ZIP
 * archives, e-mail (.eml), and a best-effort read of the old binary Office
 * formats (.doc .xls .ppt .msg). Each returns plain text in the same shape as
 * the other readers: headings as #, lists as -, tables as Markdown.
 */

import { unzipSync } from 'fflate';
import { decodeCp1252, decodeText, htmlToText } from './text';
import { childElements, findAll, findFirst, isElement, parseXml, type XmlElement } from './xml';

type Parts = Record<string, Uint8Array>;
const utf8 = new TextDecoder('utf-8');

function cell(text: string): string {
    return text.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();
}

export function markdownTable(rows: string[][]): string {
    const width = Math.max(0, ...rows.map((r) => r.length));
    if (!width) {
        return '';
    }
    const lines = rows.map((r) => `| ${Array.from({ length: width }, (_, i) => cell(r[i] ?? '')).join(' | ')} |`);
    lines.splice(1, 0, `|${' --- |'.repeat(width)}`);
    return lines.join('\n');
}

// ---------------------------------------------------------------- OpenDocument

/** Text of an ODF paragraph: spans, spaces, tabs, line breaks and links in order. */
function odfInline(el: XmlElement): string {
    let out = '';
    for (const child of el.children) {
        if (typeof child === 'string') {
            out += child;
            continue;
        }
        switch (child.name) {
            case 's':
                out += ' '.repeat(Number(child.attrs.c ?? 1) || 1);
                break;
            case 'tab':
                out += '\t';
                break;
            case 'line-break':
                out += '\n';
                break;
            case 'note': {
                const body = findFirst(child, 'note-body');
                out += body ? ` [note: ${odfInline(body).trim()}]` : '';
                break;
            }
            case 'annotation':
                break;
            case 'a': {
                const text = odfInline(child);
                const href = child.attrs.href;
                out += href && href !== text && !href.startsWith('#') ? `[${text}](${href})` : text;
                break;
            }
            case 'frame': {
                const title = findFirst(child, 'title') ?? findFirst(child, 'desc');
                out += findFirst(child, 'image') ? `[Image${title ? `: ${odfInline(title).trim()}` : ''}]` : '';
                break;
            }
            default:
                out += odfInline(child);
        }
    }
    return out;
}

function odfTable(table: XmlElement): string {
    const rows: string[][] = [];
    for (const row of findAll(table, 'table-row')) {
        const repeat = Math.min(Number(row.attrs['number-rows-repeated'] ?? 1) || 1, 20);
        const cells: string[] = [];
        for (const c of childElements(row).filter((x) => x.name === 'table-cell' || x.name === 'covered-table-cell')) {
            const span = Math.min(Number(c.attrs['number-columns-repeated'] ?? 1) || 1, 50);
            const text = childElements(c, 'p').map(odfInline).join(' ');
            for (let i = 0; i < span; i++) {
                cells.push(text);
            }
        }
        while (cells.length && !cells[cells.length - 1]) {
            cells.pop();
        }
        for (let i = 0; i < repeat; i++) {
            if (cells.length) {
                rows.push(cells);
            }
        }
    }
    return markdownTable(rows);
}

function odfBlocks(container: XmlElement, out: string[], depth = 0): void {
    for (const el of childElements(container)) {
        switch (el.name) {
            case 'h': {
                const level = Math.min(Number(el.attrs['outline-level'] ?? 1) || 1, 6);
                const text = odfInline(el).trim();
                if (text) {
                    out.push(`${'#'.repeat(level)} ${text}`);
                }
                break;
            }
            case 'p': {
                const text = odfInline(el).trim();
                if (text) {
                    out.push(text);
                }
                break;
            }
            case 'list':
                for (const item of childElements(el, 'list-item')) {
                    const parts: string[] = [];
                    odfBlocks(item, parts, depth + 1);
                    if (parts.length) {
                        out.push(`${'  '.repeat(depth)}- ${parts.join(' ').replace(/^- /, '')}`);
                    }
                }
                break;
            case 'table': {
                const name = el.attrs.name;
                const table = odfTable(el);
                if (table) {
                    out.push(container.name === 'spreadsheet' && name ? `--- Sheet: ${name} ---\n${table}` : table);
                }
                break;
            }
            case 'page': {
                const parts: string[] = [];
                odfBlocks(el, parts, depth);
                for (const frame of childElements(el, 'frame')) {
                    odfBlocks(frame, parts, depth);
                }
                out.push(`--- Slide ${out.filter((b) => b.startsWith('--- Slide')).length + 1}${el.attrs.name ? `: ${el.attrs.name}` : ''} ---\n${parts.join('\n\n')}`);
                break;
            }
            case 'section':
            case 'text-box':
            case 'frame':
            case 'custom-shape':
            case 'g':
                odfBlocks(el, out, depth);
                break;
            default:
                break;
        }
    }
}

export function extractOdf(parts: Parts): { format: string; text: string; pages?: number } {
    const mime = parts.mimetype ? utf8.decode(parts.mimetype).trim() : '';
    const root = parts['content.xml'] ? parseXml(utf8.decode(parts['content.xml'])) : undefined;
    const body = root && findFirst(root, 'body');
    const content = body && childElements(body)[0];
    const format = /spreadsheet/.test(mime) ? 'ods' : /presentation/.test(mime) ? 'odp' : 'odt';
    const blocks: string[] = [];
    if (content) {
        odfBlocks(content, blocks);
    }
    const slides = blocks.filter((b) => b.startsWith('--- Slide')).length;
    return { format, text: blocks.join('\n\n'), pages: slides || undefined };
}

export function isOdf(parts: Parts): boolean {
    const mime = parts.mimetype ? utf8.decode(parts.mimetype).trim() : '';
    return /^application\/vnd\.oasis\.opendocument\./.test(mime) || !!parts['content.xml'];
}

// ---------------------------------------------------------------- EPUB

export function isEpub(parts: Parts): boolean {
    return (parts.mimetype ? utf8.decode(parts.mimetype).trim() : '') === 'application/epub+zip' || !!parts['META-INF/container.xml'];
}

export function extractEpub(parts: Parts): { text: string; pages: number } {
    const container = parts['META-INF/container.xml'] ? parseXml(utf8.decode(parts['META-INF/container.xml'])) : undefined;
    const opfPath = (container && findFirst(container, 'rootfile')?.attrs['full-path']) ?? Object.keys(parts).find((p) => p.endsWith('.opf'));
    const opf = opfPath && parts[opfPath] ? parseXml(utf8.decode(parts[opfPath])) : undefined;
    const base = opfPath?.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const manifest = new Map<string, string>();
    for (const item of opf ? findAll(opf, 'item') : []) {
        if (item.attrs.id && item.attrs.href) {
            manifest.set(item.attrs.id, base + decodeURIComponent(item.attrs.href));
        }
    }
    let order = (opf ? findAll(opf, 'itemref') : []).map((ref) => manifest.get(ref.attrs.idref ?? '')).filter((p): p is string => !!p && !!parts[p]);
    if (!order.length) {
        order = Object.keys(parts).filter((p) => /\.x?html?$/i.test(p)).sort();
    }
    const title = opf ? findFirst(opf, 'title') : undefined;
    const chapters = order.map((p) => htmlToText(utf8.decode(parts[p]!)).trim()).filter(Boolean);
    const heading = title ? `# ${title.children.filter((c): c is string => typeof c === 'string').join('').trim()}\n\n` : '';
    return { text: heading + chapters.join('\n\n---\n\n'), pages: chapters.length };
}

// ---------------------------------------------------------------- ZIP archives

const TEXTY = /\.(?:txt|md|markdown|csv|tsv|json|ya?ml|xml|html?|ini|cfg|conf|toml|log|env|sql|[cm]?[jt]sx?|py|ipynb|java|kt|cs|go|rs|rb|php|swift|dart|c|h|cc|cpp|hpp|css|scss|vue|svelte|sh|ps1|bat|gradle|properties|dockerfile|gitignore)$/i;
const MAX_FILE = 200_000;

/** An archive: its file list, then the text of the readable files in it, up to `budget` characters. */
export function extractZip(bytes: Uint8Array, budget: number, nested: (name: string, data: Uint8Array) => string | undefined): { text: string; note?: string } {
    const entries: { name: string; size: number }[] = [];
    const parts = unzipSync(bytes, {
        filter: (f) => {
            if (!f.name.endsWith('/')) {
                entries.push({ name: f.name, size: f.originalSize });
            }
            return !f.name.endsWith('/') && f.originalSize <= MAX_FILE * 20 && (TEXTY.test(f.name) || /\.(?:docx|pptx|xlsx|odt|ods|odp|pdf)$/i.test(f.name) || /(?:^|\/)(?:readme|license|makefile|dockerfile)$/i.test(f.name));
        },
    });
    const skipped = entries.filter((e) => /(?:^|\/)(?:node_modules|\.git|dist|build|__pycache__|\.venv|venv)\//.test(e.name));
    const listed = entries.filter((e) => !skipped.includes(e));
    const lines = [`Archive with ${entries.length} file${entries.length === 1 ? '' : 's'}${skipped.length ? ` (${skipped.length} in node_modules, .git, build or venv folders left out)` : ''}:`];
    lines.push(...listed.slice(0, 300).map((e) => `- ${e.name} (${e.size.toLocaleString('en-US')} bytes)`));
    if (listed.length > 300) {
        lines.push(`- … and ${listed.length - 300} more`);
    }
    let left = budget - lines.join('\n').length;
    const shown: string[] = [];
    let omitted = 0;
    for (const e of listed) {
        const data = parts[e.name];
        if (!data) {
            continue;
        }
        if (left <= 500) {
            omitted++;
            continue;
        }
        const text = TEXTY.test(e.name) || !/\.\w+$/.test(e.name) ? decodeText(data)?.text : nested(e.name, data);
        if (!text?.trim()) {
            continue;
        }
        const body = text.length > Math.min(MAX_FILE, left) ? `${text.slice(0, Math.min(MAX_FILE, left))}\n… (cut)` : text;
        shown.push(`### ${e.name}\n${body}`);
        left -= body.length + e.name.length + 6;
    }
    return { text: `${lines.join('\n')}${shown.length ? `\n\n${shown.join('\n\n')}` : ''}`, note: omitted ? `${omitted} more readable files were left out to stay within the size limit.` : undefined };
}

// ---------------------------------------------------------------- E-mail

/** An .eml message, or text that starts like one. */
export function looksLikeEmail(text: string): boolean {
    const head = text.slice(0, 4000);
    return /^(?:[\w-]+:.*\r?\n)+/m.test(head) && /^from:/im.test(head) && /^(?:subject|date|to):/im.test(head) && /\r?\n\r?\n/.test(head);
}

function decodeWords(value: string): string {
    // =?utf-8?B?...?= and =?utf-8?Q?...?= encoded words in headers.
    return value.replace(/=\?([\w-]+)\?([bq])\?([^?]*)\?=/gi, (_m, charset: string, enc: string, data: string) => {
        const bytes = enc.toLowerCase() === 'b' ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) : qpBytes(data.replace(/_/g, ' '));
        return decodeCharset(bytes, charset);
    });
}

function qpBytes(text: string): Uint8Array {
    const out: number[] = [];
    const s = text.replace(/=\r?\n/g, '');
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '=' && /^[0-9A-F]{2}$/i.test(s.slice(i + 1, i + 3))) {
            out.push(parseInt(s.slice(i + 1, i + 3), 16));
            i += 2;
        } else {
            out.push(s.charCodeAt(i) & 0xff);
        }
    }
    return Uint8Array.from(out);
}

function decodeCharset(bytes: Uint8Array, charset = 'utf-8'): string {
    try {
        return /1252|latin|8859-1|ascii/i.test(charset) ? decodeCp1252(bytes) : new TextDecoder(charset.toLowerCase()).decode(bytes);
    } catch {
        return utf8.decode(bytes);
    }
}

interface MimePart {
    headers: Record<string, string>;
    body: string;
}

function splitMessage(raw: string): MimePart {
    const sep = raw.search(/\r?\n\r?\n/);
    const head = sep < 0 ? raw : raw.slice(0, sep);
    const body = sep < 0 ? '' : raw.slice(sep).replace(/^\r?\n\r?\n/, '');
    const headers: Record<string, string> = {};
    for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
        const i = line.indexOf(':');
        if (i > 0) {
            headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
        }
    }
    return { headers, body };
}

function partText(part: MimePart, attachments: string[]): { plain: string; html: string } {
    const type = part.headers['content-type'] ?? 'text/plain';
    const boundary = /boundary="?([^";]+)"?/i.exec(type)?.[1];
    if (/^multipart\//i.test(type) && boundary) {
        let plain = '';
        let html = '';
        for (const chunk of part.body.split(`--${boundary}`).slice(1)) {
            if (chunk.startsWith('--')) {
                break;
            }
            const inner = partText(splitMessage(chunk.replace(/^\r?\n/, '')), attachments);
            plain ||= inner.plain;
            html ||= inner.html;
        }
        return { plain, html };
    }
    const disposition = part.headers['content-disposition'] ?? '';
    const filename = /filename\*?="?([^";]+)"?/i.exec(disposition)?.[1] ?? /name="?([^";]+)"?/i.exec(type)?.[1];
    if (/attachment/i.test(disposition) || (filename && !/^text\//i.test(type))) {
        if (filename) {
            attachments.push(decodeWords(filename));
        }
        return { plain: '', html: '' };
    }
    const encoding = (part.headers['content-transfer-encoding'] ?? '').toLowerCase();
    const charset = /charset="?([^";]+)"?/i.exec(type)?.[1] ?? 'utf-8';
    let bytes: Uint8Array;
    if (encoding === 'base64') {
        try {
            bytes = Uint8Array.from(atob(part.body.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
        } catch {
            bytes = new TextEncoder().encode(part.body);
        }
    } else if (encoding === 'quoted-printable') {
        bytes = qpBytes(part.body);
    } else {
        return /html/i.test(type) ? { plain: '', html: part.body } : { plain: part.body, html: '' };
    }
    const text = decodeCharset(bytes, charset);
    return /html/i.test(type) ? { plain: '', html: text } : { plain: text, html: '' };
}

export function extractEmail(raw: string): string {
    const message = splitMessage(raw);
    const attachments: string[] = [];
    const { plain, html } = partText(message, attachments);
    const header = ['from', 'to', 'cc', 'date', 'subject']
        .filter((h) => message.headers[h])
        .map((h) => `${h.charAt(0).toUpperCase()}${h.slice(1)}: ${decodeWords(message.headers[h]!)}`);
    const body = (plain || htmlToText(html)).replace(/\r\n?/g, '\n').trim();
    return [header.join('\n'), body, attachments.length ? `Attachments: ${attachments.join(', ')}` : ''].filter(Boolean).join('\n\n');
}

// ---------------------------------------------------------------- Old binary Office files

/**
 * The text in an old .doc, .xls, .ppt or .msg file, recovered without their
 * formats: runs of readable UTF-16 and 8-bit text. Good for the words, not for
 * layout or tables, which the note says.
 */
export function extractLegacyText(bytes: Uint8Array): string {
    const runs: string[] = [];
    // UTF-16LE runs (Word 97+ unicode text, PowerPoint, Outlook).
    let current = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) {
        const code = bytes[i]! | (bytes[i + 1]! << 8);
        if ((code >= 0x20 && code < 0xd800 && code !== 0xfffd) || code === 0x0d || code === 0x0a || code === 0x09) {
            current += String.fromCharCode(code);
        } else {
            if (current.length >= 6) {runs.push(current);}
            current = '';
        }
    }
    if (current.length >= 6) {runs.push(current);}
    // 8-bit runs (Word text stored as cp1252, Excel strings).
    current = '';
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i]!;
        if ((b >= 0x20 && b < 0x7f) || b >= 0xa0 || b === 0x0d || b === 0x0a || b === 0x09) {
            current += decodeCp1252([b]);
        } else {
            if (current.length >= 8) {runs.push(current);}
            current = '';
        }
    }
    if (current.length >= 8) {runs.push(current);}
    // Keep runs that read like language: mostly letters and spaces, with words in them.
    const seen = new Set<string>();
    const kept: string[] = [];
    for (const raw of runs) {
        const run = raw.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').trim();
        const letters = (run.match(/[\p{L}\s.,;:!?'"()-]/gu) ?? []).length;
        const words = run.split(/\s+/).filter((w) => /^\p{L}{2,}/u.test(w)).length;
        if (run.length < 6 || letters / run.length < 0.85 || words < 2 || /^(?:Microsoft|Times New Roman|Arial|Calibri|Normal|Default Paragraph Font|Root Entry|SummaryInformation|DocumentSummaryInformation|WordDocument|CompObj)\b/.test(run)) {
            continue;
        }
        if (!seen.has(run)) {
            seen.add(run);
            kept.push(run);
        }
    }
    return kept.join('\n');
}

export function isEncryptedOffice(bytes: Uint8Array): boolean {
    // Password-protected .docx/.xlsx/.pptx are OLE files holding an "EncryptedPackage" stream.
    const needle = 'EncryptedPackage';
    const head = bytes.subarray(0, Math.min(bytes.length, 64 * 1024));
    const text = new TextDecoder('utf-16le').decode(head);
    return text.includes(needle);
}

export function allParts(bytes: Uint8Array, filter: (name: string) => boolean): Parts {
    return unzipSync(bytes, { filter: (f) => filter(f.name) && f.originalSize <= 64 * 1024 * 1024 });
}

export { isElement };
