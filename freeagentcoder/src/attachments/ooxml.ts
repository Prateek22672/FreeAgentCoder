/** DOCX / PPTX / XLSX text extraction (fflate unzip + a light XML walk). */

import { unzipSync } from 'fflate';
import { markdownTable } from './formats';
import { childElements, findAll, findFirst, firstChild, isElement, parseXml, type XmlElement } from './xml';

export type OoxmlFormat = 'docx' | 'pptx' | 'xlsx';
export type OoxmlExtract =
    | { kind: 'text'; format: OoxmlFormat; text: string; pages?: number; note?: string }
    | { kind: 'unsupported'; reason: string };

type Parts = Record<string, Uint8Array>;

const MAX_PART_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_ROWS_PER_SHEET = 2000;
const MAX_COLUMNS = 256;

export function isZip(bytes: Uint8Array): boolean {
    return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export function extractOoxml(bytes: Uint8Array, hint?: OoxmlFormat, maxRowsPerSheet = DEFAULT_MAX_ROWS_PER_SHEET): OoxmlExtract {
    let parts: Parts;
    try {
        parts = unzipSync(bytes, {
            filter: (f) => /\.(xml|rels)$/i.test(f.name) && f.originalSize <= MAX_PART_BYTES,
        });
    } catch {
        return { kind: 'unsupported', reason: 'The file looks like an Office document but its ZIP container is damaged.' };
    }
    const format: OoxmlFormat | undefined =
        parts['word/document.xml'] ? 'docx'
            : parts['ppt/presentation.xml'] ? 'pptx'
                : parts['xl/workbook.xml'] ? 'xlsx'
                    : undefined;
    if (!format) {
        return {
            kind: 'unsupported',
            reason: hint
                ? `This .${hint} file is missing its main document part and may be damaged.`
                : 'This ZIP archive is not a Word, PowerPoint or Excel document.',
        };
    }
    if (format === 'docx') {
        return { kind: 'text', format, text: extractDocx(parts) };
    }
    if (format === 'pptx') {
        const { text, slides } = extractPptx(parts);
        return { kind: 'text', format, text, pages: slides };
    }
    const { text, note } = extractXlsx(parts, maxRowsPerSheet);
    return { kind: 'text', format, text, note };
}

const utf8 = new TextDecoder('utf-8');

function readXml(parts: Parts, path: string): XmlElement | undefined {
    const data = parts[path];
    return data ? parseXml(utf8.decode(data)) : undefined;
}

/** Relationship id -> absolute part path for the given part (e.g. `word/document.xml`). */
function readRels(parts: Parts, partPath: string, typeSuffix?: string): Map<string, string> {
    const slash = partPath.lastIndexOf('/');
    const dir = slash === -1 ? '' : partPath.slice(0, slash);
    const relsPath = `${dir ? dir + '/' : ''}_rels/${partPath.slice(slash + 1)}.rels`;
    const map = new Map<string, string>();
    const root = readXml(parts, relsPath);
    if (!root) {
        return map;
    }
    for (const rel of findAll(root, 'Relationship')) {
        const { Id: id, Target: target, Type: type, TargetMode: mode } = rel.attrs;
        if (!id || !target || mode === 'External' || (typeSuffix && !type?.endsWith(typeSuffix))) {
            continue;
        }
        map.set(id, resolvePartPath(dir, target));
    }
    return map;
}

/** Relationship id -> URL, for external targets such as hyperlinks. */
function readExternalRels(parts: Parts, partPath: string): Map<string, string> {
    const slash = partPath.lastIndexOf('/');
    const dir = slash === -1 ? '' : partPath.slice(0, slash);
    const root = readXml(parts, `${dir ? dir + '/' : ''}_rels/${partPath.slice(slash + 1)}.rels`);
    const map = new Map<string, string>();
    for (const rel of root ? findAll(root, 'Relationship') : []) {
        if (rel.attrs.Id && rel.attrs.Target && rel.attrs.TargetMode === 'External') {
            map.set(rel.attrs.Id, rel.attrs.Target);
        }
    }
    return map;
}

function resolvePartPath(baseDir: string, target: string): string {
    const segments = target.startsWith('/') ? [] : baseDir.split('/').filter(Boolean);
    for (const seg of target.split('/')) {
        if (seg === '..') {
            segments.pop();
        } else if (seg && seg !== '.') {
            segments.push(seg);
        }
    }
    return segments.join('/');
}


// ---------------------------------------------------------------- DOCX

interface DocxStyles {
    headingLevel: Map<string, number>;
    listStyles: Set<string>;
    /** numId -> level -> number format ("decimal", "lowerLetter", "bullet", ...). */
    numbering?: Map<string, Map<number, string>>;
    /** Hyperlink relationship ids -> URLs. */
    links?: Map<string, string>;
    /** Running counters for numbered lists: "numId:level" -> count. */
    counters?: Map<string, number>;
    /** List styles that carry their own numbering ("List Number"): styleId -> numId. */
    styleNumbers?: Map<string, string>;
}

function readNumbering(parts: Parts): Map<string, Map<number, string>> {
    const root = readXml(parts, 'word/numbering.xml');
    const abstract = new Map<string, Map<number, string>>();
    for (const a of root ? findAll(root, 'abstractNum') : []) {
        const levels = new Map<number, string>();
        for (const lvl of childElements(a, 'lvl')) {
            levels.set(Number(lvl.attrs.ilvl ?? 0), firstChild(lvl, 'numFmt')?.attrs.val ?? 'decimal');
        }
        abstract.set(a.attrs.abstractNumId ?? '', levels);
    }
    const nums = new Map<string, Map<number, string>>();
    for (const n of root ? findAll(root, 'num') : []) {
        const ref = firstChild(n, 'abstractNumId')?.attrs.val;
        const levels = ref !== undefined ? abstract.get(ref) : undefined;
        if (n.attrs.numId && levels) {
            nums.set(n.attrs.numId, levels);
        }
    }
    return nums;
}

function roman(n: number): string {
    const table: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    let out = '';
    for (const [v, s] of table) {
        while (n >= v) {
            out += s;
            n -= v;
        }
    }
    return out;
}

/** The marker a list item shows: "1.", "b.", "iv." or "-" for bullets. */
function listMarker(styles: DocxStyles, numId: string | undefined, ilvl: number): string {
    const format = numId ? styles.numbering?.get(numId)?.get(ilvl) : undefined;
    if (!format || format === 'bullet' || format === 'none' || !numId || numId === '0') {
        return '-';
    }
    const counters = (styles.counters ??= new Map());
    const key = `${numId}:${ilvl}`;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    // A higher level starting again resets the deeper ones.
    for (const k of [...counters.keys()]) {
        const [id, level] = k.split(':');
        if (id === numId && Number(level) > ilvl) {
            counters.delete(k);
        }
    }
    switch (format) {
        case 'lowerLetter':
            return `${String.fromCharCode(96 + (((n - 1) % 26) + 1))}.`;
        case 'upperLetter':
            return `${String.fromCharCode(64 + (((n - 1) % 26) + 1))}.`;
        case 'lowerRoman':
            return `${roman(n)}.`;
        case 'upperRoman':
            return `${roman(n).toUpperCase()}.`;
        default:
            return `${n}.`;
    }
}

function readDocxStyles(parts: Parts): DocxStyles {
    const headingLevel = new Map<string, number>();
    const listStyles = new Set<string>();
    const styleNumbers = new Map<string, string>();
    const root = readXml(parts, 'word/styles.xml');
    for (const style of root ? findAll(root, 'style') : []) {
        const id = style.attrs.styleId;
        if (!id) {
            continue;
        }
        const name = (firstChild(style, 'name')?.attrs.val ?? id).toLowerCase();
        const outline = findFirst(style, 'outlineLvl')?.attrs.val;
        const heading = /^heading\s*([1-9])$/.exec(name);
        if (name === 'title') {
            headingLevel.set(id, 1);
        } else if (heading) {
            headingLevel.set(id, Number(heading[1]));
        } else if (outline !== undefined && Number(outline) < 9) {
            headingLevel.set(id, Number(outline) + 1);
        }
        if (/^list (bullet|number)/.test(name) || findFirst(style, 'numPr')) {
            listStyles.add(id);
            const styleNum = findFirst(style, 'numId')?.attrs.val;
            if (styleNum) {
                styleNumbers.set(id, styleNum);
            }
        }
    }
    return { headingLevel, listStyles, styleNumbers };
}

let docxLinks: Map<string, string> | undefined;

/** Inline text of a paragraph or table cell, in document order. */
function docxInlineText(el: XmlElement): string {
    let out = '';
    for (const child of el.children) {
        if (!isElement(child)) {
            continue;
        }
        switch (child.name) {
            case 't':
                out += child.children.filter((c): c is string => typeof c === 'string').join('');
                break;
            case 'tab':
                // <w:tab> inside <w:tabs> (paragraph properties) is a tab stop definition, not text.
                if (el.name === 'r') {
                    out += '\t';
                }
                break;
            case 'br':
            case 'cr':
                out += '\n';
                break;
            case 'noBreakHyphen':
                out += '-';
                break;
            case 'footnoteReference':
                out += `[^${child.attrs.id}]`;
                break;
            case 'endnoteReference':
                out += `[^e${child.attrs.id}]`;
                break;
            case 'del': // tracked deletion
            case 'delText':
            case 'instrText': // field code
            case 'pPr':
            case 'rPr':
            case 'Fallback': // duplicate of mc:Choice content
                break;
            case 'p':
                out += (out && !out.endsWith('\n') ? '\n' : '') + docxInlineText(child);
                break;
            case 'hyperlink': {
                const text = docxInlineText(child);
                const url = child.attrs.id ? docxLinks?.get(child.attrs.id) : undefined;
                out += url && url !== text.trim() ? `[${text}](${url})` : text;
                break;
            }
            case 'drawing':
            case 'pict': {
                const props = findFirst(child, 'docPr');
                const description = (props?.attrs.descr || props?.attrs.title || '').trim();
                const chart = findFirst(child, 'chart');
                out += chart ? `[Chart${description ? `: ${description}` : ''}]` : `[Image${description ? `: ${description}` : ''}]`;
                // Text boxes inside the drawing still carry text.
                const box = findFirst(child, 'txbxContent');
                if (box) {
                    out += ` ${docxInlineText(box)}`;
                }
                break;
            }
            default:
                out += docxInlineText(child);
        }
    }
    return out;
}

function docxBlocks(container: XmlElement, styles: DocxStyles, out: string[]): void {
    for (const el of childElements(container)) {
        if (el.name === 'p') {
            const text = docxInlineText(el).trim();
            if (!text || /^\[(?:Image|Chart)\]$/.test(text) && !findFirst(el, 'docPr')) {
                continue;
            }
            const pPr = firstChild(el, 'pPr');
            const styleId = pPr ? firstChild(pPr, 'pStyle')?.attrs.val : undefined;
            const outline = pPr ? firstChild(pPr, 'outlineLvl')?.attrs.val : undefined;
            const numPr = pPr ? firstChild(pPr, 'numPr') : undefined;
            const level = (styleId && styles.headingLevel.get(styleId))
                ?? (outline !== undefined && Number(outline) < 9 ? Number(outline) + 1 : undefined);
            if (level) {
                out.push(`${'#'.repeat(Math.min(level, 6))} ${text.replace(/\n+/g, ' ')}`);
            } else if (numPr || (styleId && styles.listStyles.has(styleId))) {
                const ilvl = Number((numPr && firstChild(numPr, 'ilvl')?.attrs.val) ?? 0) || 0;
                const numId = (numPr ? firstChild(numPr, 'numId')?.attrs.val : undefined) ?? (styleId ? styles.styleNumbers?.get(styleId) : undefined);
                out.push(`${'  '.repeat(Math.min(ilvl, 8))}${listMarker(styles, numId, ilvl)} ${text}`);
            } else {
                out.push(text);
            }
        } else if (el.name === 'tbl') {
            const rows = childElements(el, 'tr').map((tr) =>
                findAll(tr, 'tc').map((tc) => {
                    const cellParts: string[] = [];
                    docxBlocks(tc, styles, cellParts);
                    return cellParts.join(' ');
                }));
            const table = markdownTable(rows);
            if (table) {
                out.push(table);
            }
        } else if (el.name === 'sdt') {
            const content = firstChild(el, 'sdtContent');
            if (content) {
                docxBlocks(content, styles, out);
            }
        } else if (el.name === 'customXml' || el.name === 'ins' || el.name === 'smartTag') {
            docxBlocks(el, styles, out);
        }
    }
}

function docxNotes(parts: Parts, path: string, noteName: string, prefix: string, styles: DocxStyles): string[] {
    const root = readXml(parts, path);
    const out: string[] = [];
    for (const note of root ? findAll(root, noteName) : []) {
        const type = note.attrs.type;
        if (type === 'separator' || type === 'continuationSeparator' || type === 'continuationNotice') {
            continue;
        }
        const blocks: string[] = [];
        docxBlocks(note, styles, blocks);
        const text = blocks.join(' ').trim();
        if (text) {
            out.push(`[^${prefix}${note.attrs.id}]: ${text}`);
        }
    }
    return out;
}

/** The distinct text of the page headers or footers. */
function docxHeaderFooter(parts: Parts, kind: 'header' | 'footer', styles: DocxStyles): string {
    const seen = new Set<string>();
    for (const name of Object.keys(parts).filter((p) => new RegExp(`^word/${kind}\\d*\\.xml$`).test(p)).sort()) {
        const root = readXml(parts, name);
        const blocks: string[] = [];
        const part = root && findFirst(root, kind === 'header' ? 'hdr' : 'ftr');
        if (part) {
            docxBlocks(part, styles, blocks);
        }
        const text = blocks.join(' ').replace(/\s+/g, ' ').trim();
        if (text && !/^(?:page\s*)?\d+$/i.test(text)) {
            seen.add(text);
        }
    }
    return [...seen].join(' | ');
}

function docxComments(parts: Parts, styles: DocxStyles): string[] {
    const root = readXml(parts, 'word/comments.xml');
    return (root ? findAll(root, 'comment') : [])
        .map((c) => {
            const blocks: string[] = [];
            docxBlocks(c, styles, blocks);
            const text = blocks.join(' ').trim();
            return text ? `- ${c.attrs.author ? `${c.attrs.author}: ` : ''}${text}` : '';
        })
        .filter(Boolean);
}

function extractDocx(parts: Parts): string {
    const styles: DocxStyles = { ...readDocxStyles(parts), numbering: readNumbering(parts), counters: new Map() };
    docxLinks = readExternalRels(parts, 'word/document.xml');
    const doc = readXml(parts, 'word/document.xml');
    const body = doc && findFirst(doc, 'body');
    const blocks: string[] = [];
    if (body) {
        docxBlocks(body, styles, blocks);
    }
    const header = docxHeaderFooter(parts, 'header', styles);
    const footer = docxHeaderFooter(parts, 'footer', styles);
    if (header) {
        blocks.unshift(`Page header: ${header}`);
    }
    if (footer) {
        blocks.push(`Page footer: ${footer}`);
    }
    const comments = docxComments(parts, styles);
    if (comments.length) {
        blocks.push(`Comments:\n${comments.join('\n')}`);
    }
    const notes = [
        ...docxNotes(parts, 'word/footnotes.xml', 'footnote', '', styles),
        ...docxNotes(parts, 'word/endnotes.xml', 'endnote', 'e', styles),
    ];
    let text = joinBlocks(blocks);
    if (notes.length) {
        text += `\n\n---\nNotes:\n${notes.join('\n')}`;
    }
    return text;
}

/** Join blocks with blank lines, but keep consecutive list items tight. */
function joinBlocks(blocks: string[]): string {
    let out = '';
    blocks.forEach((block, i) => {
        if (i > 0) {
            const item = /^\s*(?:-|\d+\.|[a-zA-Z]\.|[ivxlcdm]+\.) /i;
        const isList = item.test(block) && item.test(blocks[i - 1]);
            out += isList ? '\n' : '\n\n';
        }
        out += block;
    });
    return out;
}

// ---------------------------------------------------------------- PPTX

function drawingParagraphs(txBody: XmlElement): string[] {
    return childElements(txBody, 'p').map((p) => {
        let line = '';
        for (const child of childElements(p)) {
            if (child.name === 'r' || child.name === 'fld') {
                const t = firstChild(child, 't');
                line += t ? t.children.filter((c): c is string => typeof c === 'string').join('') : '';
            } else if (child.name === 'br') {
                line += '\n';
            }
        }
        return line.trim();
    }).filter(Boolean);
}

interface ShapeText { placeholder?: string; text: string }

/** A chart part as a title and a Markdown table of its series. */
export function chartText(root: XmlElement | undefined): string {
    if (!root) {
        return '';
    }
    const strings = (el: XmlElement | undefined) => (el ? findAll(el, 'pt').map((pt) => firstChild(pt, 'v')?.children.filter((c): c is string => typeof c === 'string').join('') ?? '') : []);
    const titleEl = findFirst(root, 'title');
    const title = titleEl ? findAll(titleEl, 't').map((t) => t.children.filter((c): c is string => typeof c === 'string').join('')).join('').trim() : '';
    const series = findAll(root, 'ser').map((ser) => ({
        name: strings(firstChild(ser, 'tx'))[0] ?? 'Series',
        categories: strings(firstChild(ser, 'cat')),
        values: strings(firstChild(ser, 'val') ?? firstChild(ser, 'yVal')),
    }));
    if (!series.length) {
        return title ? `Chart: ${title}` : '';
    }
    const categories = series[0]!.categories.length ? series[0]!.categories : series[0]!.values.map((_, i) => String(i + 1));
    const rows = [['', ...series.map((s) => s.name)], ...categories.map((c, i) => [c, ...series.map((s) => s.values[i] ?? '')])];
    return `Chart${title ? `: ${title}` : ''}\n${markdownTable(rows)}`;
}

let slideCharts: ((rId: string) => string) | undefined;

function collectShapes(tree: XmlElement, out: ShapeText[]): void {
    for (const el of childElements(tree)) {
        if (el.name === 'sp') {
            const ph = findFirst(firstChild(el, 'nvSpPr') ?? el, 'ph');
            const txBody = firstChild(el, 'txBody');
            const text = txBody ? drawingParagraphs(txBody).join('\n') : '';
            if (text) {
                out.push({ placeholder: ph ? (ph.attrs.type ?? 'body') : undefined, text });
            }
        } else if (el.name === 'grpSp') {
            collectShapes(el, out);
        } else if (el.name === 'graphicFrame') {
            const tbl = findFirst(el, 'tbl');
            const chart = findFirst(el, 'chart');
            if (chart && slideCharts) {
                const text = slideCharts(chart.attrs.id ?? '');
                if (text) {
                    out.push({ text });
                }
            }
            if (tbl) {
                const rows = childElements(tbl, 'tr').map((tr) =>
                    childElements(tr, 'tc').map((tc) => {
                        const body = firstChild(tc, 'txBody');
                        return body ? drawingParagraphs(body).join(' ') : '';
                    }));
                const table = markdownTable(rows);
                if (table) {
                    out.push({ text: table });
                }
            }
        } else if (el.name === 'AlternateContent') {
            const choice = firstChild(el, 'Choice');
            if (choice) {
                collectShapes(choice, out);
            }
        }
    }
}

function slideShapes(root: XmlElement | undefined): ShapeText[] {
    const tree = root && findFirst(root, 'spTree');
    const shapes: ShapeText[] = [];
    if (tree) {
        collectShapes(tree, shapes);
    }
    return shapes;
}

function extractPptx(parts: Parts): { text: string; slides: number } {
    const presentation = readXml(parts, 'ppt/presentation.xml');
    const rels = readRels(parts, 'ppt/presentation.xml');
    let slidePaths = (presentation ? findAll(presentation, 'sldId') : [])
        .map((s) => rels.get(s.attrs.id ?? ''))
        .filter((p): p is string => !!p && !!parts[p]);
    if (!slidePaths.length) {
        slidePaths = Object.keys(parts)
            .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
            .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1]));
    }

    const sections = slidePaths.map((path, index) => {
        const charts = readRels(parts, path, '/chart');
        slideCharts = (rId) => chartText(readXml(parts, charts.get(rId) ?? ''));
        const shapes = slideShapes(readXml(parts, path));
        const isTitle = (s: ShapeText) => s.placeholder === 'title' || s.placeholder === 'ctrTitle';
        const lines: string[] = [];
        for (const s of shapes.filter(isTitle)) {
            lines.push(`# ${s.text.replace(/\n+/g, ' ')}`);
        }
        for (const s of shapes.filter((x) => !isTitle(x) && !['sldNum', 'dt', 'ftr', 'hdr'].includes(x.placeholder ?? ''))) {
            lines.push(s.text);
        }
        const notesPath = [...readRels(parts, path, '/notesSlide').values()][0];
        if (notesPath) {
            const notes = slideShapes(readXml(parts, notesPath))
                .filter((s) => s.placeholder === 'body')
                .map((s) => s.text)
                .join('\n');
            if (notes) {
                lines.push(`Speaker notes:\n${notes}`);
            }
        }
        return `--- Slide ${index + 1} ---\n${lines.join('\n\n')}`.trimEnd();
    });
    return { text: sections.join('\n\n'), slides: slidePaths.length };
}

// ---------------------------------------------------------------- XLSX

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function readDateStyles(parts: Parts): Set<number> {
    const dateStyles = new Set<number>();
    const root = readXml(parts, 'xl/styles.xml');
    if (!root) {
        return dateStyles;
    }
    const custom = new Map<number, string>();
    for (const fmt of findAll(root, 'numFmt')) {
        custom.set(Number(fmt.attrs.numFmtId), fmt.attrs.formatCode ?? '');
    }
    const cellXfs = findFirst(root, 'cellXfs');
    childElements(cellXfs ?? root, 'xf').forEach((xf, index) => {
        if (!cellXfs) {
            return;
        }
        const id = Number(xf.attrs.numFmtId ?? 0);
        const code = custom.get(id);
        const cleaned = code?.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
        if (BUILTIN_DATE_FORMATS.has(id) || (cleaned && /[dmyhs]/i.test(cleaned) && !/^general$/i.test(cleaned))) {
            dateStyles.add(index);
        }
    });
    return dateStyles;
}

function serialToDate(serial: number): string {
    // Excel's 1900 epoch (including the fake 1900-02-29) maps to 1899-12-30 for serials > 60.
    const ms = Math.round((serial - 25569) * 86400000);
    const iso = new Date(ms).toISOString();
    return serial % 1 === 0 ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
}

function columnIndex(ref: string | undefined): number | undefined {
    const letters = ref && /^[A-Z]+/i.exec(ref)?.[0];
    if (!letters) {
        return undefined;
    }
    let n = 0;
    for (const ch of letters.toUpperCase()) {
        n = n * 26 + (ch.charCodeAt(0) - 64);
    }
    return n - 1;
}

function csvField(value: string): string {
    return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function stringItemText(si: XmlElement): string {
    // Concatenate <t> in runs, skipping phonetic hints (<rPh>).
    let out = '';
    for (const child of childElements(si)) {
        if (child.name === 't') {
            out += child.children.filter((c): c is string => typeof c === 'string').join('');
        } else if (child.name === 'r') {
            out += stringItemText(child);
        }
    }
    return out;
}

function extractXlsx(parts: Parts, maxRows: number): { text: string; note?: string } {
    const sharedRoot = readXml(parts, 'xl/sharedStrings.xml');
    const shared = sharedRoot ? childElements(findFirst(sharedRoot, 'sst') ?? sharedRoot, 'si').map(stringItemText) : [];
    const dateStyles = readDateStyles(parts);
    const workbook = readXml(parts, 'xl/workbook.xml');
    const rels = readRels(parts, 'xl/workbook.xml');
    const truncatedSheets: string[] = [];

    const sections = (workbook ? findAll(workbook, 'sheet') : []).map((sheet) => {
        const name = sheet.attrs.name ?? 'Sheet';
        const hidden = sheet.attrs.state && sheet.attrs.state !== 'visible' ? ' (hidden)' : '';
        const path = rels.get(sheet.attrs.id ?? '');
        const data = path ? parts[path] : undefined;
        if (!data) {
            return `--- Sheet: ${name}${hidden} ---\n(no cell data: chart sheet or missing part)`;
        }
        let xml = utf8.decode(data);
        const totalRows = (xml.match(/<(?:\w+:)?row[\s>]/g) ?? []).length;
        if (totalRows > maxRows) {
            // Cut after the maxRows-th </row>; the lenient parser closes the rest.
            const re = /<\/(?:\w+:)?row>/g;
            for (let i = 0; i < maxRows && re.exec(xml); i++) {
                // advance
            }
            xml = xml.slice(0, re.lastIndex);
            truncatedSheets.push(`${name} (${maxRows} of ${totalRows} rows)`);
        }
        const root = parseXml(xml);
        const sheetData = findFirst(root, 'sheetData');
        const lines: string[] = [];
        for (const row of sheetData ? childElements(sheetData, 'row') : []) {
            const values: string[] = [];
            let next = 0;
            for (const c of childElements(row, 'c')) {
                const col = columnIndex(c.attrs.r) ?? next;
                if (col >= MAX_COLUMNS) {
                    break;
                }
                next = col + 1;
                const v = firstChild(c, 'v');
                const f = firstChild(c, 'f');
                const formula = f ? f.children.filter((x): x is string => typeof x === 'string').join('') : '';
                const saved = v ? v.children.filter((x): x is string => typeof x === 'string').join('') : '';
                // A formula with no saved result (the file was written by a script, not Excel) shows the formula.
                const raw = saved !== '' ? saved : formula ? `=${formula}` : '';
                let value: string;
                switch (c.attrs.t) {
                    case 's':
                        value = shared[Number(raw)] ?? '';
                        break;
                    case 'inlineStr': {
                        const is = firstChild(c, 'is');
                        value = is ? stringItemText(is) : raw;
                        break;
                    }
                    case 'b':
                        value = raw === '1' ? 'TRUE' : raw === '0' ? 'FALSE' : raw;
                        break;
                    case 'n':
                    case undefined: {
                        const num = Number(raw);
                        value = raw !== '' && Number.isFinite(num) && dateStyles.has(Number(c.attrs.s ?? -1))
                            && num > 0 && num < 2958466 ? serialToDate(num) : raw;
                        break;
                    }
                    default: // str (formula string), e (error), d (ISO date)
                        value = raw;
                }
                values[col] = csvField(value);
            }
            while (values.length && !values[values.length - 1]) {
                values.pop();
            }
            if (values.length) {
                lines.push(Array.from(values, (x) => x ?? '').join(','));
            }
        }
        return `--- Sheet: ${name}${hidden} ---\n${lines.join('\n')}`.trimEnd();
    });

    return {
        text: sections.join('\n\n'),
        note: truncatedSheets.length ? `Rows were capped per sheet: ${truncatedSheets.join('; ')}.` : undefined,
    };
}
