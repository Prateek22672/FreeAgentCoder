import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { unzipSync } from 'fflate';
import { displayPath, toolError, type Tool } from '@agentic/core';
import { loadPdfJs } from './pdf';
import { renderToPdf } from './render';
import { childElements, findAll, findFirst, firstChild, parseXml, type XmlElement } from './xml';

/**
 * check_document: opens a finished deck, Word document or PDF and reports what
 * a reader would notice, so the agent fixes it before calling the work done:
 * empty template placeholders, text running off a slide or out of its box,
 * type too small to read, near-empty or overcrowded slides, runs of blank
 * paragraphs, leftover placeholder text, and blank PDF pages.
 */

const EMU_PER_PT = 12_700;
const PLACEHOLDER_TEXT = /lorem ipsum|click to (?:add|edit)|\[(?:insert|add|your)[^\]]*\]|\bTBD\b|\bTODO\b|xxx+|placeholder text|sample text/i;

export interface DocReport {
    kind: 'pptx' | 'docx' | 'pdf';
    summary: string;
    problems: string[];
}

const textOf = (el: XmlElement): string =>
    findAll(el, 't')
        .map((t) => t.children.filter((c): c is string => typeof c === 'string').join(''))
        .join('');

function partsOf(bytes: Uint8Array): Record<string, Uint8Array> {
    return unzipSync(bytes, { filter: (f) => /\.(xml|rels)$/i.test(f.name) });
}

const xml = (parts: Record<string, Uint8Array>, name: string) => (parts[name] ? parseXml(new TextDecoder().decode(parts[name])) : undefined);

export function checkPptx(bytes: Uint8Array): DocReport {
    const parts = partsOf(bytes);
    const size = xml(parts, 'ppt/presentation.xml');
    const sldSz = size && findFirst(size, 'sldSz');
    const width = Number(sldSz?.attrs.cx ?? 12_192_000);
    const height = Number(sldSz?.attrs.cy ?? 6_858_000);
    const slides = Object.keys(parts)
        .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
        .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
    const problems: string[] = [];
    let pictures = 0;
    const smallSlides: number[] = [];
    slides.forEach((name, i) => {
        const root = xml(parts, name)!;
        const n = i + 1;
        const tree = findFirst(root, 'spTree');
        let words = 0;
        let visuals = 0;
        let chars = 0;
        let smallChars = 0;
        for (const shape of tree ? childElements(tree).filter((el) => ['sp', 'pic', 'graphicFrame', 'grpSp', 'cxnSp'].includes(el.name)) : []) {
            const ph = findFirst(shape, 'ph');
            const text = textOf(shape).trim();
            words += text ? text.split(/\s+/).length : 0;
            if (shape.name !== 'sp') {visuals++;}
            if (shape.name === 'sp' && ph && !text && !['sldNum', 'dt', 'ftr', 'hdr'].includes(ph.attrs.type ?? '')) {
                problems.push(`Slide ${n}: an empty ${ph.attrs.type ?? 'content'} placeholder shows "Click to add…" in PowerPoint. Fill it or delete it.`);
            }
            if (PLACEHOLDER_TEXT.test(text)) {
                problems.push(`Slide ${n}: placeholder text left in: "${text.slice(0, 60)}".`);
            }
            const xfrm = findFirst(shape, 'xfrm');
            const off = xfrm && firstChild(xfrm, 'off');
            const ext = xfrm && firstChild(xfrm, 'ext');
            if (off && ext) {
                const x = Number(off.attrs.x), y = Number(off.attrs.y), cx = Number(ext.attrs.cx), cy = Number(ext.attrs.cy);
                if (x < -EMU_PER_PT * 2 || y < -EMU_PER_PT * 2 || x + cx > width + EMU_PER_PT * 2 || y + cy > height + EMU_PER_PT * 2) {
                    const what = shape.name === 'pic' ? 'a picture' : shape.name === 'graphicFrame' ? 'a chart or table' : text ? `"${text.slice(0, 40)}"` : 'a shape';
                    problems.push(`Slide ${n}: ${what} runs off the slide (to ${((x + cx) / 914_400).toFixed(2)} × ${((y + cy) / 914_400).toFixed(2)} in on a ${(width / 914_400).toFixed(2)} × ${(height / 914_400).toFixed(2)} in slide).`);
                }
                if (shape.name === 'sp' && text) {
                    // Text that cannot fit its box: estimated lines at the font size against the box height.
                    const sizes = findAll(shape, 'rPr').map((r) => Number(r.attrs.sz)).filter((v) => v > 0);
                    const pt = sizes.length ? Math.min(...sizes) / 100 : 18;
                    const autofit = findFirst(shape, 'normAutofit') || findFirst(shape, 'spAutoFit');
                    if (cx > 0 && cy > 0 && !autofit) {
                        const charsPerLine = Math.max(1, cx / EMU_PER_PT / (pt * 0.52));
                        const paragraphs = childElements(findFirst(shape, 'txBody') ?? shape, 'p').map((para) => textOf(para));
                        const lines = paragraphs.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
                        if (lines * pt * 1.25 > (cy / EMU_PER_PT) * 1.2 + pt) {
                            problems.push(`Slide ${n}: "${text.slice(0, 40)}…" is too long for its box at ${pt} pt (about ${lines} lines in room for ${Math.max(1, Math.floor(cy / EMU_PER_PT / (pt * 1.25)))}). Shorten it, enlarge the box or split the slide.`);
                        }
                    }
                    // Footers, slide numbers and source lines along the bottom edge are meant to be small.
                    if (!ph?.attrs.type?.match(/sldNum|dt|ftr/) && y < height * 0.88) {
                        chars += text.length;
                        if (sizes.length && Math.max(...sizes) < 1200) {smallChars += text.length;}
                    }
                }
            }
        }
        if (chars > 80 && smallChars / chars > 0.5) {smallSlides.push(n);}
        if (tree) {pictures += findAll(tree, 'pic').length;}
        if (words < 4 && !visuals) {
            problems.push(`Slide ${n} is nearly empty: add its content or a visual, or remove it.`);
        } else if (words > 110) {
            problems.push(`Slide ${n} is crowded (${words} words): split it, or move detail to the speaker notes.`);
        }
    });
    if (smallSlides.length) {
        problems.push(`Most of the text on slide${smallSlides.length === 1 ? '' : 's'} ${smallSlides.join(', ')} is under 12 pt, too small to read on a screen: use 18 pt or more for body text (captions and sources can stay smaller).`);
    }
    return { kind: 'pptx', summary: `${slides.length} slides, ${pictures} pictures, ${(width / 914_400).toFixed(2)} × ${(height / 914_400).toFixed(2)} in`, problems: dedupe(problems) };
}

export function checkDocx(bytes: Uint8Array): DocReport {
    const parts = partsOf(bytes);
    const doc = xml(parts, 'word/document.xml');
    const body = doc && findFirst(doc, 'body');
    const problems: string[] = [];
    let blankRun = 0;
    let blankRuns = 0;
    let longestBlank = 0;
    let words = 0;
    let headings = 0;
    const paragraphs = body ? childElements(body, 'p') : [];
    for (const p of paragraphs) {
        const text = textOf(p).trim();
        const hasContent = text || findFirst(p, 'drawing') || findFirst(p, 'pict') || findFirst(p, 'br');
        const style = findFirst(p, 'pStyle')?.attrs.val ?? '';
        if (/heading|title/i.test(style)) {headings++;}
        if (!hasContent) {
            blankRun++;
            continue;
        }
        if (blankRun >= 2) {
            blankRuns++;
            longestBlank = Math.max(longestBlank, blankRun);
        }
        blankRun = 0;
        words += text.split(/\s+/).filter(Boolean).length;
        if (PLACEHOLDER_TEXT.test(text)) {problems.push(`Placeholder text left in: "${text.slice(0, 60)}".`);}
    }
    if (blankRuns) {problems.push(`${blankRuns} gap${blankRuns === 1 ? '' : 's'} made of empty paragraphs (up to ${longestBlank} in a row): set paragraph spacing or a page break instead.`);}
    if (words > 600 && headings === 0) {problems.push('A long document with no headings: add Heading 1 and 2 styles so it can be scanned (and gets a table of contents).');}
    for (const tbl of body ? findAll(body, 'tbl') : []) {
        const cells = findAll(tbl, 'tc');
        const empty = cells.filter((c) => !textOf(c).trim()).length;
        if (cells.length >= 4 && empty / cells.length > 0.4) {problems.push(`A table has ${empty} of ${cells.length} cells empty: fill them or remove the empty rows and columns.`);}
    }
    const images = body ? findAll(body, 'drawing').length : 0;
    return { kind: 'docx', summary: `${words} words, ${headings} headings, ${images} images, ${body ? findAll(body, 'tbl').length : 0} tables`, problems: dedupe(problems) };
}

export async function checkPdf(bytes: Uint8Array): Promise<DocReport> {
    const pdfjs = await (await loadPdfJs()).getResolvedPDFJS();
    const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, disableFontFace: true });
    const doc = await task.promise;
    const problems: string[] = [];
    const blank: number[] = [];
    let sparse = 0;
    for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const text = (await page.getTextContent()).items.map((i: any) => i.str ?? '').join(' ').trim();
        const ops = (await page.getOperatorList()).fnArray.length;
        if (text.length < 15 && ops < 25) {blank.push(n);}
        else if (text.length < 60 && ops < 60) {sparse++;}
        if (PLACEHOLDER_TEXT.test(text)) {problems.push(`Page ${n}: placeholder text left in.`);}
        page.cleanup();
    }
    if (blank.length) {problems.push(`Blank page${blank.length === 1 ? '' : 's'}: ${blank.join(', ')}. Remove them or the page breaks that make them.`);}
    const pages = doc.numPages;
    await task.destroy().catch(() => undefined);
    return { kind: 'pdf', summary: `${pages} pages${sparse ? `, ${sparse} with very little on them` : ''}`, problems: dedupe(problems) };
}

function dedupe(items: string[]): string[] {
    return [...new Set(items)].slice(0, 25);
}

/**
 * Looks at the rendered pages (a vision model reading the PDF) and returns
 * what a reader would notice, or undefined when no model can look.
 */
export type VisualReview = (pdf: Uint8Array, name: string, signal: AbortSignal) => Promise<string | undefined>;

/** Inline PDFs above this are not sent for review. */
const MAX_REVIEW_BYTES = 18_000_000;

/** The pages as they look: rendered, then read by a vision model. A line saying why when that is not possible. */
async function lookAt(file: string, look: VisualReview | undefined, signal: AbortSignal): Promise<string> {
    if (!look) {
        return 'Not looked at visually: no reviewer is available, so only the file structure was checked.';
    }
    const rendered = await renderToPdf(file, signal);
    if ('error' in rendered) {
        return `Not looked at visually: ${rendered.error}`;
    }
    const pdf = new Uint8Array(await readFile(rendered.pdf));
    if (pdf.byteLength > MAX_REVIEW_BYTES) {
        return `Not looked at visually: the rendered PDF is ${Math.round(pdf.byteLength / 1e6)} MB; compress its pictures and check again.`;
    }
    try {
        const review = await look(pdf, path.basename(file), signal);
        return review?.trim()
            ? `How it looks (rendered with ${rendered.via}, reviewed page by page):\n${review.trim()}`
            : 'Not looked at visually: no Gemini key is set, so only the file structure was checked.';
    } catch (err) {
        return `Not looked at visually: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`;
    }
}

/** check_document without a visual review: the file structure only. */
export const checkDocumentTool: Tool<{ path: string }> = documentCheckTool();

/** check_document; with `look`, the rendered pages are also reviewed by a vision model. */
export function documentCheckTool(look?: VisualReview): Tool<{ path: string }> {
    return {
        name: 'check_document',
        description:
            'Open a finished .pptx, .docx or .pdf and report what a reader would notice: empty template placeholders, text off the slide or too long for its box, type too small, near-empty or crowded slides, blank paragraphs used as spacing, leftover placeholder text, blank pages. It also renders the pages and has a vision model look at them (cut-off or overlapping text, contrast, walls of text, weak pictures, inconsistent design, a weak structure). Run it on every document you make before calling it done, fix what it finds in the build script, rebuild and check again.',
        parameters: {
            type: 'object',
            properties: { path: { type: 'string', description: 'The .pptx, .docx or .pdf to check' } },
            required: ['path'],
        },
        kind: 'read',
        label: (a, ws) => `Check ${displayPath(ws, ws.resolve(a.path))}`,
        paths: (a, ws) => [ws.resolve(a.path)],
        async prepare(args, ctx) {
            const file = ctx.workspace.resolve(args.path);
            const ext = path.extname(file).toLowerCase();
            if (!['.pptx', '.docx', '.pdf'].includes(ext)) {return toolError('check_document reads .pptx, .docx and .pdf files.');}
            return {
                run: async () => {
                    try {
                        const bytes = new Uint8Array(await readFile(file));
                        const report = ext === '.pptx' ? checkPptx(bytes) : ext === '.docx' ? checkDocx(bytes) : await checkPdf(bytes);
                        const shown = displayPath(ctx.workspace, file);
                        const structure = report.problems.length
                            ? `${shown}: ${report.summary}.\nNot done yet: fix these, rebuild, and check again:\n${report.problems.map((p) => `- ${p}`).join('\n')}`
                            : `${shown}: ${report.summary}. No layout problems found in the file.`;
                        const seen = await lookAt(file, look, ctx.signal);
                        const reviewed = seen.startsWith('How it looks');
                        const ready = reviewed && /\bready as it is\b/i.test(seen);
                        return {
                            content: `${structure}\n\n${seen}${reviewed && !ready ? '\nFix what the review lists in the build script, rebuild, and check again.' : ''}`,
                            summary: report.problems.length
                                ? `${report.problems.length} problem${report.problems.length === 1 ? '' : 's'}`
                                : reviewed && !ready
                                  ? 'reviewed: changes suggested'
                                  : 'looks right',
                        };
                    } catch (err) {
                        return toolError(`Could not open ${args.path}: ${err instanceof Error ? err.message : String(err)}`);
                    }
                },
            };
        },
    };
}
