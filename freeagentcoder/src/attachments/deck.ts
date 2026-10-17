import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { imageSize } from 'image-size';
import PptxGenJS from 'pptxgenjs';
import { displayPath, toolError, type Tool } from '@agentic/core';
import { checkPptx, type VisualReview } from './docCheck';
import { ICON_NAMES } from './icons';
import { iconPoints } from './iconShapes';
import { renderToPdf } from './render';

/**
 * make_deck: a presentation from an outline. The model writes what each slide
 * says; tested layouts decide how it looks (the PPTAgent and Presenton idea:
 * content apart from design). Before this, the agent wrote hundreds of lines of
 * python-pptx and matplotlib per deck and repeated the same mistakes (a 0-255
 * tuple passed to matplotlib, bars clipped by their own axis, a blank PDF,
 * invented "impact scores").
 *
 * The look follows decks people make with Gamma: pictures that fill one side
 * of the slide, line icons on cards, small tags above titles, a coloured rule
 * over each card and column, numbered steps with dividers, tables, galleries,
 * a callout for the line to remember, and a closing statement. Built with
 * PptxGenJS (MIT): charts are native and editable, icons are native shapes,
 * the PDF comes from LibreOffice or PowerPoint, and the pages are reviewed as
 * the audience will see them.
 */

export const LAYOUTS = [
    'title',
    'section',
    'bullets',
    'cards',
    'two_columns',
    'steps',
    'timeline',
    'table',
    'big_number',
    'chart',
    'gallery',
    'quote',
    'image',
    'takeaways',
    'closing',
    'sources',
] as const;
export type Layout = (typeof LAYOUTS)[number];

export interface SlideSpec {
    layout: Layout;
    title?: string;
    /** A short tag above the title ("TOOLKIT · 02"); on title and closing slides, the line under the title. */
    subtitle?: string;
    points?: string[];
    left?: { heading: string; points: string[] };
    right?: { heading: string; points: string[] };
    cards?: { heading: string; text: string; icon?: string; label?: string }[];
    steps?: { label?: string; heading?: string; text: string }[];
    table?: { columns: string[]; rows: string[][] };
    items?: string[];
    gallery?: { heading: string; text: string; image?: string; imageNote?: string; credit?: string }[];
    number?: string;
    label?: string;
    detail?: string;
    chart?: { type: 'bar' | 'column' | 'line' | 'pie' | 'doughnut'; categories: string[]; series: { name: string; values: number[] }[] };
    takeaway?: string;
    source?: string;
    quote?: string;
    by?: string;
    image?: string;
    imageNote?: string;
    imageSide?: 'left' | 'right';
    credit?: string;
    caption?: string;
    /** One line to remember, in a highlighted bar at the bottom ("Final thought: …"). */
    callout?: string;
    notes?: string;
}

export interface DeckSpec {
    path: string;
    title: string;
    subtitle?: string;
    theme?: ThemeName;
    slides: SlideSpec[];
}

interface Theme {
    dark: boolean;
    bg: string;
    surface: string;
    text: string;
    muted: string;
    /** The palette for cards, columns and steps, in order. */
    accents: string[];
    line: string;
    head: string;
    body: string;
    tag: string;
    /** A title slide filled with colour (when there is no picture). */
    titleBg?: string;
}

const THEMES = {
    editorial: { dark: true, bg: '1F2023', surface: '2D2E33', text: 'F2EBE3', muted: 'B3AA9F', accents: ['D9733B', 'E9B872', 'C2553C', '8FB3A8'], line: '45464C', head: 'Georgia', body: 'Segoe UI', tag: 'Consolas' },
    workshop: { dark: false, bg: 'FFFFFF', surface: 'F4F6FB', text: '111827', muted: '4B5563', accents: ['1F4FD8', 'F28C28', 'D6246E', '1F8A4C'], line: 'E5E7EB', head: 'Segoe UI Black', body: 'Segoe UI', tag: 'Consolas', titleBg: '1F4FD8' },
    terminal: { dark: true, bg: '0E0E10', surface: '1C1C20', text: 'F5F5F5', muted: 'A1A1AA', accents: ['EC4899', 'A78BFA', '22D3EE', 'F59E0B'], line: '2A2A30', head: 'Consolas', body: 'Segoe UI', tag: 'Consolas' },
    midnight: { dark: true, bg: '0F172A', surface: '1E293B', text: 'F8FAFC', muted: '94A3B8', accents: ['38BDF8', 'F472B6', 'A3E635', 'FBBF24'], line: '334155', head: 'Segoe UI Semibold', body: 'Segoe UI', tag: 'Consolas' },
    ivory: { dark: false, bg: 'FAFAF7', surface: 'FFFFFF', text: '1F2933', muted: '6B7280', accents: ['2563EB', 'F59E0B', 'DB2777', '059669'], line: 'E5E7EB', head: 'Segoe UI Semibold', body: 'Segoe UI', tag: 'Consolas' },
    forest: { dark: false, bg: 'F4F7F2', surface: 'FFFFFF', text: '1E2B22', muted: '5F6F65', accents: ['2F855A', 'C05621', '2B6CB0', 'B7791F'], line: 'D9E3D4', head: 'Georgia', body: 'Segoe UI', tag: 'Consolas' },
    ember: { dark: true, bg: '1C1917', surface: '292524', text: 'FAFAF9', muted: 'A8A29E', accents: ['FB923C', '60A5FA', 'F472B6', 'A3E635'], line: '44403C', head: 'Segoe UI Semibold', body: 'Segoe UI', tag: 'Consolas' },
    ocean: { dark: false, bg: 'F0F7FA', surface: 'FFFFFF', text: '0F2533', muted: '587083', accents: ['0E7490', 'E11D48', '7C3AED', 'D97706'], line: 'D4E4EC', head: 'Segoe UI Semibold', body: 'Segoe UI', tag: 'Consolas', titleBg: '0E7490' },
} satisfies Record<string, Theme>;
export type ThemeName = keyof typeof THEMES;
const THEME_NAMES = Object.keys(THEMES) as ThemeName[];

const W = 13.333;
const H = 7.5;
const M = 0.65;
const BOTTOM = 6.85;
/** The share of the slide a side picture fills, edge to edge. */
const PANEL = 0.42;
/** Layouts that put a picture beside their content, full height. */
const PANEL_LAYOUTS = new Set<Layout>(['bullets', 'steps', 'timeline', 'big_number', 'quote', 'closing', 'cards', 'takeaways']);

// ---------------------------------------------------------------- repairs

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);
const firstStr = (o: Loose, ...keys: string[]) => keys.map((k) => str(o[k])).find((v) => v !== undefined && v !== '');

const LAYOUT_NAMES: Record<string, Layout> = {
    comparison: 'two_columns',
    compare: 'two_columns',
    columns: 'two_columns',
    pros_cons: 'two_columns',
    stat: 'big_number',
    stats: 'big_number',
    number: 'big_number',
    metric: 'big_number',
    list: 'bullets',
    intro: 'bullets',
    content: 'bullets',
    text: 'bullets',
    process: 'steps',
    numbered: 'steps',
    history: 'timeline',
    images: 'gallery',
    examples: 'gallery',
    photo: 'image',
    picture: 'image',
    conclusion: 'takeaways',
    summary: 'takeaways',
    key_takeaways: 'takeaways',
    thanks: 'closing',
    thank_you: 'closing',
    end: 'closing',
    references: 'sources',
    citations: 'sources',
    cover: 'title',
    title_slide: 'title',
};

/** A list of strings, whatever shape the model wrote it in. */
function asStrings(v: unknown): string[] | undefined {
    if (!Array.isArray(v)) {return typeof v === 'string' && v.trim() ? [v] : undefined;}
    return v
        .map((x) => (isObj(x) ? [firstStr(x, 'heading', 'title', 'label', 'name'), firstStr(x, 'text', 'description', 'detail', 'body', 'url')].filter(Boolean).join(': ') : str(x)))
        .filter((x): x is string => !!x);
}

/**
 * The outline with the slips models make put right, so a deck is not refused
 * (and the agent does not fall back to writing a script) over a field name:
 * gallery items written as `items`, cards or steps as `points`, a timeline as
 * "1956: text" strings, columns as plain lists, a chart as {label, value}
 * pairs, table rows as objects, layouts called "comparison" or "conclusion".
 */
export function repairDeck(raw: Loose): Loose {
    const args: Loose = { ...raw };
    if (typeof args.slides === 'string') {
        try {
            args.slides = JSON.parse(args.slides);
        } catch {
            // left for validation to report
        }
    }
    if (!Array.isArray(args.slides)) {return args;}
    args.slides = args.slides.map((input) => {
        if (!isObj(input)) {return input;}
        const s: Loose = { ...input };
        let layout = String(s.layout ?? s.type ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_');
        layout = (LAYOUT_NAMES[layout] ?? layout) as string;
        s.layout = layout;
        delete s.type;
        if (!s.title && str(s.heading)) {s.title = s.heading;}
        if (!s.image) {s.image = firstStr(s, 'imagePath', 'image_path', 'img', 'picture');}
        if (!s.imageNote) {s.imageNote = firstStr(s, 'image_note', 'imageDescription', 'image_description');}
        if (!s.by) {s.by = firstStr(s, 'author', 'attribution', 'speaker');}
        const list = Array.isArray(s.items) ? s.items : Array.isArray(s.points) ? s.points : undefined;
        const objects = list?.filter(isObj) ?? [];
        switch (layout) {
            case 'gallery':
                if (!Array.isArray(s.gallery) && objects.length) {
                    s.gallery = objects.map((o) => ({ heading: firstStr(o, 'heading', 'title', 'name', 'label') ?? '', text: firstStr(o, 'text', 'description', 'caption', 'detail') ?? '', image: firstStr(o, 'image', 'imagePath', 'img'), imageNote: firstStr(o, 'imageNote', 'image_note'), credit: firstStr(o, 'credit') }));
                    delete s.items;
                }
                break;
            case 'cards':
                if (!Array.isArray(s.cards) && objects.length) {
                    s.cards = objects.map((o) => ({ heading: firstStr(o, 'heading', 'title', 'name', 'label') ?? '', text: firstStr(o, 'text', 'description', 'detail', 'body') ?? '', icon: firstStr(o, 'icon'), label: firstStr(o, 'tag') }));
                    delete s.items;
                    delete s.points;
                } else if (!Array.isArray(s.cards) && list?.length) {
                    s.cards = asStrings(list)!.map((t) => {
                        const [h, ...rest] = t.split(/:\s+/);
                        return rest.length ? { heading: h!, text: rest.join(': ') } : { heading: t, text: t };
                    });
                    delete s.points;
                }
                break;
            case 'steps':
            case 'timeline': {
                const raw2 = Array.isArray(s.steps) ? s.steps : list;
                if (Array.isArray(raw2)) {
                    s.steps = raw2.map((x) => {
                        if (isObj(x)) {return { label: firstStr(x, 'label', 'year', 'date', 'step'), heading: firstStr(x, 'heading', 'title', 'name'), text: firstStr(x, 'text', 'description', 'detail', 'event') ?? '' };}
                        const t = str(x) ?? '';
                        const m = /^\s*([^:–-]{1,24}?)\s*[:–-]\s+(.+)$/.exec(t);
                        return layout === 'timeline' ? (m ? { label: m[1], text: m[2] } : { label: '', text: t }) : m ? { heading: m[1], text: m[2] } : { heading: t, text: t };
                    });
                    if (!Array.isArray(input.steps)) {
                        delete s.items;
                        delete s.points;
                    }
                }
                break;
            }
            case 'two_columns': {
                const fix = (side: unknown, fallback: string) => (Array.isArray(side) ? { heading: fallback, points: asStrings(side) ?? [] } : isObj(side) ? { heading: firstStr(side, 'heading', 'title') ?? fallback, points: asStrings(side.points ?? side.items) ?? [] } : side);
                const cols = Array.isArray(s.columns) ? s.columns : undefined;
                s.left = fix(s.left ?? cols?.[0], 'Advantages');
                s.right = fix(s.right ?? cols?.[1], 'Disadvantages');
                delete s.columns;
                break;
            }
            case 'big_number':
                if (typeof s.number === 'number') {s.number = String(s.number);}
                if (!s.label) {s.label = firstStr(s, 'caption', 'subtitle') ?? (str(s.detail) ? str(s.detail)!.split(/(?<=\.)\s/)[0] : undefined);}
                break;
            case 'chart': {
                const c = isObj(s.chart) ? { ...s.chart } : undefined;
                if (c) {
                    if (Array.isArray(c.data) && c.data.every(isObj)) {
                        const data = c.data as Loose[];
                        c.categories = data.map((d) => firstStr(d, 'label', 'category', 'name', 'x') ?? '');
                        c.series = [{ name: str(c.name) ?? str(s.title) ?? 'Value', values: data.map((d) => Number(d.value ?? d.y ?? 0)) }];
                        delete c.data;
                    }
                    if (Array.isArray(c.series) && c.series.every((v) => typeof v === 'number')) {
                        c.series = [{ name: str(s.title) ?? 'Value', values: c.series }];
                    }
                    if (Array.isArray(c.labels) && !c.categories) {c.categories = c.labels;}
                    if (!c.type) {c.type = 'column';}
                    s.chart = c;
                }
                break;
            }
            case 'table': {
                const t = isObj(s.table) ? { ...s.table } : undefined;
                if (t && Array.isArray(t.rows) && t.rows.every(isObj)) {
                    const rows = t.rows as Loose[];
                    const columns = Array.isArray(t.columns) ? (t.columns as string[]) : Object.keys(rows[0] ?? {});
                    t.columns = columns;
                    t.rows = rows.map((r) => columns.map((col) => str(r[col]) ?? ''));
                    s.table = t;
                }
                break;
            }
            default:
                break;
        }
        // Lists of plain text where the model wrote objects.
        for (const key of ['points', 'items']) {
            if (Array.isArray(s[key]) && (s[key] as unknown[]).some(isObj)) {s[key] = asStrings(s[key]);}
        }
        return s;
    });
    return args;
}

/** How each layout is written, shown when a slide cannot be built. */
const SHAPES: Partial<Record<Layout, string>> = {
    cards: '{ layout: "cards", title, cards: [{ heading, text, icon }] }',
    gallery: '{ layout: "gallery", title, gallery: [{ heading, text, image }] }',
    steps: '{ layout: "steps", title, steps: [{ heading, text }] }',
    timeline: '{ layout: "timeline", title, steps: [{ label: "1997", text }] }',
    two_columns: '{ layout: "two_columns", title, left: { heading, points: [...] }, right: { heading, points: [...] } }',
    table: '{ layout: "table", title, table: { columns: [...], rows: [[...], [...]] } }',
    big_number: '{ layout: "big_number", title, number: "40%", label, detail, source }',
    chart: '{ layout: "chart", title, chart: { type: "column", categories: [...], series: [{ name, values: [...] }] }, takeaway, source }',
    quote: '{ layout: "quote", quote, by }',
};

// ---------------------------------------------------------------- validation

const LIMITS = { points: 6, pointChars: 170, titleChars: 90, cards: [2, 4], steps: [2, 6], timeline: [3, 6], gallery: [2, 4], columns: [2, 5], rows: 7, categories: 12, callout: 180 } as const;
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const hasPicture = (s: SlideSpec) => !!(s.image || s.imageNote);

/** What must change before the deck can be built (`errors`), and what is worth improving (`advice`). */
export function deckProblems(spec: DeckSpec): { errors: string[]; advice: string[] } {
    const errors: string[] = [];
    const advice: string[] = [];
    if (!spec.slides?.length) {errors.push('Give at least one slide.');}
    if (spec.theme && !THEME_NAMES.includes(spec.theme)) {errors.push(`theme must be one of ${THEME_NAMES.join(', ')}.`);}
    const slides = spec.slides ?? [];
    slides.forEach((s, i) => {
        const at = `Slide ${i + 1} (${s.layout})`;
        if (!LAYOUTS.includes(s.layout)) {
            errors.push(`Slide ${i + 1}: layout "${String(s.layout)}" is not one of ${LAYOUTS.join(', ')}.`);
            return;
        }
        if (s.title && s.title.length > LIMITS.titleChars) {errors.push(`${at}: the title has ${s.title.length} characters; keep it under ${LIMITS.titleChars} (one line that says the point).`);}
        if (s.callout && s.callout.length > LIMITS.callout) {errors.push(`${at}: the callout has ${s.callout.length} characters; keep it under ${LIMITS.callout}.`);}
        const needs = (field: keyof SlideSpec, what: string) => {
            const v = s[field];
            if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) {errors.push(`${at}: needs ${what}.`);}
        };
        const pointList = (list: string[] | undefined, where: string) => {
            if (!list) {return;}
            if (list.length > LIMITS.points) {errors.push(`${at}: ${where} has ${list.length} points; at most ${LIMITS.points}. Split it into two slides or put detail in notes.`);}
            list.forEach((p, k) => {
                if (p.length > LIMITS.pointChars) {errors.push(`${at}: point ${k + 1} has ${p.length} characters; keep each under ${LIMITS.pointChars} and put detail in notes.`);}
            });
        };
        const count = (list: unknown[] | undefined, [lo, hi]: readonly [number, number], what: string) => {
            if (!list || list.length < lo || list.length > hi) {errors.push(`${at}: needs ${lo} to ${hi} ${what}.`);}
        };
        if (!['title', 'quote', 'sources', 'closing'].includes(s.layout)) {needs('title', 'a title');}
        switch (s.layout) {
            case 'bullets':
            case 'takeaways':
                needs('points', 'points');
                pointList(s.points, 'it');
                break;
            case 'two_columns':
                if (!s.left?.points?.length || !s.right?.points?.length || !s.left.heading || !s.right.heading) {errors.push(`${at}: needs left and right, each with a heading and points.`);}
                pointList(s.left?.points, 'the left column');
                pointList(s.right?.points, 'the right column');
                break;
            case 'cards':
                count(s.cards, LIMITS.cards, 'cards');
                s.cards?.forEach((c, k) => {
                    if (!c.heading || !c.text) {errors.push(`${at}: card ${k + 1} needs a heading and text.`);}
                    if (c.text && words(c.text) > 32) {errors.push(`${at}: card ${k + 1} has ${words(c.text)} words; keep cards under 32.`);}
                    if (c.icon && !ICON_NAMES.includes(c.icon)) {advice.push(`${at}: there is no icon "${c.icon}" (a number is shown instead). Icons: ${ICON_NAMES.join(', ')}.`);}
                });
                if (s.cards?.length && !s.cards.some((c) => c.icon)) {advice.push(`${at}: give each card an icon; Gamma-style cards read faster with one.`);}
                break;
            case 'steps':
                count(s.steps, LIMITS.steps, 'steps');
                s.steps?.forEach((st, k) => {
                    if (!st.heading || !st.text) {errors.push(`${at}: step ${k + 1} needs a heading and text.`);}
                });
                break;
            case 'timeline':
                count(s.steps, LIMITS.timeline, 'steps');
                s.steps?.forEach((st, k) => {
                    if (!st.label || !st.text) {errors.push(`${at}: step ${k + 1} needs a label (a year or phase) and text.`);}
                });
                break;
            case 'table': {
                const t = s.table;
                if (!t?.columns?.length || t.columns.length < LIMITS.columns[0] || t.columns.length > LIMITS.columns[1]) {errors.push(`${at}: needs table.columns, ${LIMITS.columns[0]} to ${LIMITS.columns[1]} of them.`);}
                if (!t?.rows?.length || t.rows.length > LIMITS.rows) {errors.push(`${at}: needs table.rows, 1 to ${LIMITS.rows} of them.`);}
                t?.rows?.forEach((r, k) => {
                    if (t.columns && r.length !== t.columns.length) {errors.push(`${at}: row ${k + 1} has ${r.length} cells for ${t.columns.length} columns.`);}
                });
                break;
            }
            case 'gallery':
                count(s.gallery, LIMITS.gallery, 'gallery items');
                s.gallery?.forEach((g, k) => {
                    if (!g.heading || !g.text) {errors.push(`${at}: item ${k + 1} needs a heading and text.`);}
                });
                break;
            case 'big_number':
                needs('number', 'the number');
                needs('label', 'a label saying what the number is');
                needs('source', 'source: where the figure comes from (a figure without one is not shown)');
                break;
            case 'chart': {
                const c = s.chart;
                needs('source', 'source: where the figures come from. If they are not real, sourced figures, use cards or two_columns instead of a chart');
                if (!c || !c.categories?.length || !c.series?.length) {
                    errors.push(`${at}: needs chart with categories and series.`);
                    break;
                }
                if (c.categories.length > LIMITS.categories) {errors.push(`${at}: ${c.categories.length} categories; at most ${LIMITS.categories}.`);}
                if ((c.type === 'pie' || c.type === 'doughnut') && c.series.length > 1) {errors.push(`${at}: a ${c.type} chart takes one series.`);}
                c.series.forEach((ser) => {
                    if (ser.values?.length !== c.categories.length || ser.values.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
                        errors.push(`${at}: series "${ser.name}" needs one number for each of the ${c.categories.length} categories.`);
                    }
                });
                if (!s.takeaway) {advice.push(`${at}: add takeaway, the one sentence the chart proves.`);}
                break;
            }
            case 'quote':
                needs('quote', 'the quote');
                needs('by', 'by: who said it and when');
                advice.push(`${at}: keep a quote only if you are sure of its exact words and who said them; otherwise use big_number or cards.`);
                break;
            case 'image':
                if (!hasPicture(s)) {errors.push(`${at}: needs image (a file) or imageNote (what the picture should show).`);}
                break;
            case 'closing':
                if (!s.title) {errors.push(`${at}: needs title, the closing statement.`);}
                break;
            case 'sources':
                needs('items', 'items');
                if (s.items?.some((it) => it.length < 25 || !/(?:19|20)\d{2}/.test(it))) {
                    advice.push(`${at}: write each source as a full citation (who, what, year), e.g. "World Economic Forum, The Future of Jobs Report 2025"; "Wikimedia images" or "X data" is not a source. List only what the slides cite.`);
                }
                break;
            default:
                break;
        }
    });
    const broken = new Set(errors.map((e) => /^Slide (\d+)/.exec(e)?.[1]).filter(Boolean));
    for (const n of broken) {
        const shape = SHAPES[slides[Number(n) - 1]?.layout as Layout];
        if (shape) {errors.push(`Slide ${n} is written like this: ${shape}`);}
    }
    for (let i = 2; i < slides.length; i++) {
        if (slides[i]!.layout === slides[i - 1]!.layout && slides[i]!.layout === slides[i - 2]!.layout) {
            advice.push(`Slides ${i - 1} to ${i + 1} all use ${slides[i]!.layout}: vary the layouts (cards, steps, table, big_number, gallery, timeline) so the deck does not read as one list.`);
        }
    }
    if (slides.length < 12 && slides.some((s) => s.layout === 'section')) {
        advice.push('A section slide is mostly empty; in a deck under 12 slides drop it and let the next title carry the point.');
    }
    if (slides.length > 3 && !slides.some((s) => hasPicture(s) || s.layout === 'gallery' || s.layout === 'chart')) {
        advice.push('No slide has a picture: give the title slide and one or two others a real photo from find_image (it fills one side of the slide).');
    }
    return { errors, advice };
}

// ---------------------------------------------------------------- layout helpers

/** The largest size from `max` down to `min` at which the text fits its box (about half an em per character). */
export function fitFont(lines: string[], boxW: number, boxH: number, max: number, min: number, gap = 0.12, em = 0.52): number {
    for (let pt = max; pt > min; pt -= 1) {
        const perLine = Math.max(6, Math.floor((boxW * 72) / (pt * em)));
        const rows = lines.reduce((n, line) => n + Math.max(1, Math.ceil(line.length / perLine)), 0);
        if ((rows * pt * 1.22) / 72 + lines.length * gap <= boxH) {return pt;}
    }
    return min;
}

/** About how tall text runs at `pt` in a box `w` inches wide. */
function textHeight(lines: string[], w: number, pt: number, gap = 0, em = 0.52): number {
    const perLine = Math.max(6, Math.floor((w * 72) / (pt * em)));
    const rows = lines.reduce((n, line) => n + Math.max(1, Math.ceil(line.length / perLine)), 0);
    return (rows * pt * 1.22) / 72 + lines.length * gap;
}

/** White or near-black, whichever reads on a fill. */
function ink(fill: string): string {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(fill.slice(i, i + 2), 16) / 255);
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.6 ? '111111' : 'FFFFFF';
}

type Slide = ReturnType<PptxGenJS['addSlide']>;

interface Ctx {
    pptx: PptxGenJS;
    t: Theme;
    /** Where picture paths are looked up, in order: beside the deck, then the project folder. */
    roots: string[];
    missing: string[];
}

/** Where content goes on a slide: beside its picture panel, when it has one. */
interface Area {
    x: number;
    w: number;
    panel?: { x: number; w: number };
}

function areaFor(s: SlideSpec, n: number): Area {
    if (!hasPicture(s) || !PANEL_LAYOUTS.has(s.layout)) {
        return { x: M, w: W - 2 * M };
    }
    const pw = W * PANEL;
    const left = (s.imageSide ?? (n % 2 === 0 ? 'right' : 'right')) === 'left';
    return left ? { x: pw + M, w: W - pw - 2 * M, panel: { x: 0, w: pw } } : { x: M, w: W - pw - 2 * M, panel: { x: W - pw, w: pw } };
}

function pill(slide: Slide, c: Ctx, text: string, x: number, y: number, fill: string, size = 10): number {
    const label = text.toUpperCase();
    const w = Math.min(6.5, 0.42 + label.length * size * 0.0098);
    slide.addShape(c.pptx.ShapeType.roundRect, { x, y, w, h: 0.3, rectRadius: 0.15, fill: { color: fill }, line: { type: 'none' } });
    slide.addText(label, { x, y, w, h: 0.3, fontFace: c.t.tag, fontSize: size, color: ink(fill), bold: true, align: 'center', valign: 'middle', charSpacing: 1, margin: 0 });
    return w;
}

/** The title with its tag above it; returns where the content starts. */
function header(slide: Slide, c: Ctx, area: Area, title: string, kicker?: string): number {
    let y = 0.55;
    if (kicker) {
        pill(slide, c, kicker, area.x, y, c.t.accents[0]!);
        y += 0.45;
    }
    const size = fitFont([title], area.w, 1.0, 32, 22, 0, c.t.head === 'Consolas' ? 0.6 : 0.5);
    slide.addText(title, { x: area.x, y, w: area.w, h: 1.0, fontFace: c.t.head, fontSize: size, color: c.t.text, valign: 'top', margin: 0, fit: 'shrink' });
    const lines = Math.max(1, Math.ceil(title.length / Math.floor((area.w * 72) / (size * 0.5))));
    return y + (lines * size * 1.25) / 72 + 0.4;
}

function footer(slide: Slide, c: Ctx, area: Area, deckTitle: string, n: number): void {
    slide.addText(deckTitle, { x: area.x, y: H - 0.42, w: area.w - 1, h: 0.25, fontFace: c.t.body, fontSize: 9, color: c.t.muted, margin: 0 });
    slide.addText(String(n), { x: area.x + area.w - 1, y: H - 0.42, w: 1, h: 0.25, fontFace: c.t.body, fontSize: 9, color: c.t.muted, align: 'right', margin: 0 });
}

function bulletList(slide: Slide, c: Ctx, points: string[], x: number, y: number, w: number, h: number, max = 22): void {
    const pt = fitFont(points, w - 0.35, h, max, 13, 0.14);
    slide.addText(
        points.map((p) => ({ text: p, options: { bullet: { code: '25A0', indent: pt * 1.1 }, paraSpaceAfter: pt * 0.6 } })),
        { x, y, w, h, fontFace: c.t.body, fontSize: pt, color: c.t.text, valign: 'top', margin: 0 },
    );
}

function card(slide: Slide, c: Ctx, x: number, y: number, w: number, h: number, rule?: string): void {
    slide.addShape(c.pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.08, fill: { color: c.t.surface }, line: c.t.dark ? { type: 'none' } : { color: c.t.line, width: 0.75 } });
    if (rule) {slide.addShape(c.pptx.ShapeType.rect, { x: x + 0.02, y, w: w - 0.04, h: 0.06, fill: { color: rule }, line: { type: 'none' } });}
}

/** A line icon in a tinted circle, drawn as a native shape; false when there is no such icon. */
function iconBadge(slide: Slide, c: Ctx, name: string | undefined, x: number, y: number, color: string, d = 0.62): boolean {
    const size = d * 0.56;
    const points = name ? iconPoints(name, size) : undefined;
    if (!points) {return false;}
    slide.addShape(c.pptx.ShapeType.ellipse, { x, y, w: d, h: d, fill: { color, transparency: c.t.dark ? 78 : 86 }, line: { type: 'none' } });
    // 'custGeom' is in PptxGenJS but missing from its type list.
    slide.addShape('custGeom' as never, {
        x: x + (d - size) / 2,
        y: y + (d - size) / 2,
        w: size,
        h: size,
        points: points as never,
        line: { color, width: 1.6 },
        fill: { type: 'none' } as never,
    });
    return true;
}

async function loadPicture(c: Ctx, file: string | undefined): Promise<{ data: string; ratio: number } | undefined> {
    if (!file) {return undefined;}
    let bytes: Buffer | undefined;
    for (const root of c.roots) {
        bytes = await readFile(path.resolve(root, file)).catch(() => undefined);
        if (bytes) {break;}
    }
    if (!bytes) {return undefined;}
    try {
        const size = imageSize(bytes);
        if (!size.width || !size.height) {return undefined;}
        const ext = (path.extname(file).slice(1) || 'png').toLowerCase().replace('jpg', 'jpeg');
        return { data: `image/${ext};base64,${bytes.toString('base64')}`, ratio: size.height / size.width };
    } catch {
        return undefined;
    }
}

/** A real picture cropped to its frame, or a labelled frame saying what belongs there. */
async function picture(slide: Slide, c: Ctx, file: string | undefined, note: string | undefined, credit: string | undefined, x: number, y: number, w: number, h: number, bleed = false): Promise<void> {
    const pic = await loadPicture(c, file);
    if (pic) {
        slide.addImage({ data: pic.data, x, y, w, h: w * pic.ratio, sizing: { type: 'cover', w, h } });
        if (credit) {
            if (bleed) {
                slide.addText(credit, { x: x + 0.15, y: y + h - 0.32, w: w - 0.3, h: 0.24, fontFace: c.t.body, fontSize: 8, color: 'FFFFFF', margin: [0, 4, 0, 4], fill: { color: '000000', transparency: 55 } });
            } else {
                slide.addText(credit, { x, y: y + h + 0.04, w, h: 0.22, fontFace: c.t.body, fontSize: 8, color: c.t.muted, margin: 0 });
            }
        }
        return;
    }
    const what = note ?? file ?? 'a picture';
    c.missing.push(what);
    slide.addShape(c.pptx.ShapeType.rect, { x, y, w, h, fill: { color: c.t.surface }, line: { color: c.t.muted, width: 1, dashType: 'dash' } });
    slide.addText(`Image: ${what}`, { x: x + 0.3, y, w: w - 0.6, h, fontFace: c.t.body, fontSize: 14, color: c.t.muted, align: 'center', valign: 'middle', margin: 0 });
}

function callout(slide: Slide, c: Ctx, area: Area, text: string): void {
    const y = BOTTOM - 0.62;
    const color = c.t.accents[0]!;
    slide.addShape(c.pptx.ShapeType.rect, { x: area.x, y, w: area.w, h: 0.58, fill: { color, transparency: c.t.dark ? 70 : 88 }, line: { type: 'none' } });
    slide.addShape(c.pptx.ShapeType.rect, { x: area.x, y, w: 0.07, h: 0.58, fill: { color }, line: { type: 'none' } });
    const colon = text.indexOf(':');
    const runs = colon > 0 && colon < 40 ? [{ text: text.slice(0, colon + 1), options: { bold: true } }, { text: text.slice(colon + 1) }] : [{ text }];
    slide.addText(runs, { x: area.x + 0.25, y, w: area.w - 0.4, h: 0.58, fontFace: c.t.body, fontSize: fitFont([text], area.w - 0.4, 0.5, 15, 11, 0), color: c.t.text, valign: 'middle', margin: 0 });
}

// ---------------------------------------------------------------- slides

async function drawSlide(c: Ctx, spec: DeckSpec, s: SlideSpec, n: number): Promise<void> {
    const { pptx, t } = c;
    const slide = pptx.addSlide();
    slide.background = { color: t.bg };
    const area = areaFor(s, n);
    const bottom = s.callout ? BOTTOM - 0.8 : BOTTOM;
    const title = s.title ?? '';
    if (area.panel && s.layout !== 'title') {
        await picture(slide, c, s.image, s.imageNote, s.credit, area.panel.x, 0, area.panel.w, H, true);
    }
    switch (s.layout) {
        case 'title': {
            const text = title || spec.title;
            const sub = s.subtitle ?? spec.subtitle;
            if (hasPicture(s)) {
                const pw = W * PANEL;
                await picture(slide, c, s.image, s.imageNote, s.credit, 0, 0, pw, H, true);
                const x = pw + 0.7;
                const w = W - x - M;
                slide.addText(text, { x, y: 2.0, w, h: 2.4, fontFace: t.head, fontSize: fitFont([text], w, 2.4, 44, 28, 0, 0.5), color: t.text, valign: 'bottom', margin: 0 });
                if (sub) {slide.addText(sub, { x, y: 4.6, w, h: 1.1, fontFace: t.body, fontSize: 16, color: t.muted, valign: 'top', margin: 0 });}
                if (s.detail) {slide.addText(s.detail, { x, y: 6.3, w, h: 0.4, fontFace: t.tag, fontSize: 11, color: t.accents[0], margin: 0 });}
            } else {
                const fill = t.titleBg ?? t.bg;
                const fg = t.titleBg ? ink(fill) : t.text;
                slide.background = { color: fill };
                if (s.label) {pill(slide, c, s.label, M, 0.8, t.titleBg ? t.accents[1]! : t.accents[0]!);}
                slide.addText(text, { x: M, y: 1.6, w: 8.6, h: 2.8, fontFace: t.head, fontSize: fitFont([text], 8.6, 2.8, 48, 30, 0, 0.5), color: fg, valign: 'bottom', margin: 0 });
                if (sub) {slide.addText(sub, { x: M, y: 4.6, w: 8.2, h: 1.0, fontFace: t.body, fontSize: 18, color: t.titleBg ? fg : t.muted, valign: 'top', margin: 0 });}
                const lineColor = t.titleBg ? t.accents[1]! : t.accents[0]!;
                slide.addShape(pptx.ShapeType.line, { x: M, y: 6.55, w: 6, h: 0, line: { color: lineColor, width: 3 } });
                slide.addShape(pptx.ShapeType.ellipse, { x: M + 5.3, y: 6.39, w: 0.32, h: 0.32, fill: { color: fill }, line: { color: lineColor, width: 3 } });
                if (s.detail) {slide.addText(s.detail, { x: M, y: 5.85, w: 8, h: 0.4, fontFace: t.tag, fontSize: 12, color: t.titleBg ? fg : t.accents[0], margin: 0 });}
            }
            break;
        }
        case 'section': {
            slide.addText(String(n).padStart(2, '0'), { x: area.x, y: 1.9, w: 3, h: 1.4, fontFace: t.head, fontSize: 72, color: t.accents[0], margin: 0 });
            slide.addText(title, { x: area.x, y: 3.4, w: area.w, h: 1.2, fontFace: t.head, fontSize: 40, color: t.text, valign: 'top', margin: 0 });
            if (s.subtitle) {slide.addText(s.subtitle, { x: area.x, y: 4.65, w: Math.min(9, area.w), h: 1, fontFace: t.body, fontSize: 18, color: t.muted, valign: 'top', margin: 0 });}
            break;
        }
        case 'bullets': {
            const top = header(slide, c, area, title, s.subtitle);
            bulletList(slide, c, s.points ?? [], area.x, top, area.w, bottom - top);
            break;
        }
        case 'cards': {
            const top = header(slide, c, area, title, s.subtitle);
            const cards = s.cards ?? [];
            // Four cards sit in a 2 x 2 grid, as Gamma lays them out, unless they are only a few words each.
            const grid = cards.length === 4 && (!!area.panel || cards.reduce((n2, k) => n2 + k.text.length, 0) / cards.length > 40);
            const cols = grid ? 2 : cards.length;
            const rows = grid ? 2 : 1;
            const gap = 0.25;
            const cw = (area.w - gap * (cols - 1)) / cols;
            const room = (bottom - top - gap * (rows - 1)) / rows;
            const textW = cw - 0.6;
            // A single row of short cards has room to spare: larger type fills it instead of leaving half the slide empty.
            const textPt = Math.min(...cards.map((k) => fitFont([k.text], textW, room - 1.9, grid ? 16 : 19, 11, 0)));
            const headPt = Math.min(...cards.map((k) => fitFont([k.heading], textW, 0.7, grid ? 19 : 22, 13, 0)));
            const lead = cards.some((k) => k.icon && iconPoints(k.icon, 1)) ? 0.8 : 0.6;
            const needed = 0.3 + lead + Math.max(...cards.map((k) => textHeight([k.heading], textW, headPt))) + 0.2 + Math.max(...cards.map((k) => textHeight([k.text], textW, textPt))) + 0.4;
            const ch = Math.min(room, Math.max(2.0, needed));
            cards.forEach((k, i) => {
                const x = area.x + (i % cols) * (cw + gap);
                const y = top + Math.floor(i / cols) * (ch + gap);
                const color = t.accents[i % t.accents.length]!;
                card(slide, c, x, y, cw, ch, color);
                let ty = y + 0.3;
                if (iconBadge(slide, c, k.icon, x + 0.3, ty, color)) {
                    ty += 0.8;
                } else if (k.label) {
                    pill(slide, c, k.label, x + 0.3, ty, color);
                    ty += 0.5;
                } else {
                    slide.addText(String(i + 1).padStart(2, '0'), { x: x + 0.3, y: ty, w: 1.2, h: 0.5, fontFace: t.head, fontSize: 24, color, margin: 0 });
                    ty += 0.6;
                }
                const headH = textHeight([k.heading], textW, headPt) + 0.15;
                slide.addText(k.heading, { x: x + 0.3, y: ty, w: textW, h: headH, fontFace: t.head, fontSize: headPt, color: t.text, valign: 'top', margin: 0 });
                slide.addText(k.text, { x: x + 0.3, y: ty + headH + 0.05, w: textW, h: Math.max(0.5, y + ch - ty - headH - 0.3), fontFace: t.body, fontSize: textPt, color: t.muted, valign: 'top', margin: 0 });
            });
            break;
        }
        case 'two_columns': {
            const top = header(slide, c, area, title, s.subtitle);
            const gap = 0.35;
            const colW = (area.w - gap) / 2;
            const listH = bottom - top - 1.2;
            const pt = Math.min(fitFont(s.left!.points, colW - 1.05, listH, 18, 13, 0.14), fitFont(s.right!.points, colW - 1.05, listH, 18, 13, 0.14));
            const used = Math.max(...[s.left!, s.right!].map((col) => textHeight(col.points, colW - 1.05, pt, (pt * 0.6) / 72)));
            const colH = Math.min(bottom - top, Math.max(2.4, 1.0 + used + 0.5));
            [s.left!, s.right!].forEach((col, k) => {
                const x = area.x + k * (colW + gap);
                const color = t.accents[k]!;
                card(slide, c, x, top, colW, colH, color);
                slide.addText(col.heading, { x: x + 0.35, y: top + 0.3, w: colW - 0.7, h: 0.55, fontFace: t.head, fontSize: 20, color, margin: 0 });
                bulletList(slide, c, col.points, x + 0.35, top + 1.0, colW - 0.7, colH - 1.2, pt);
            });
            break;
        }
        case 'steps': {
            const top = header(slide, c, area, title, s.subtitle);
            const steps = s.steps ?? [];
            const rowH = (bottom - top) / steps.length;
            const textPt = Math.min(...steps.map((st) => fitFont([st.text], area.w - 1.2, rowH - 0.55, 15, 10, 0)));
            steps.forEach((st, i) => {
                const y = top + i * rowH;
                const color = t.accents[i % t.accents.length]!;
                slide.addText(st.label ?? String(i + 1).padStart(2, '0'), { x: area.x, y, w: 0.9, h: 0.35, fontFace: t.tag, fontSize: 12, color, bold: true, margin: 0 });
                slide.addShape(pptx.ShapeType.line, { x: area.x + 1.0, y: y + 0.17, w: area.w - 1.0, h: 0, line: { color: color, width: 1.25 } });
                slide.addText(st.heading ?? '', { x: area.x + 1.0, y: y + 0.25, w: area.w - 1.0, h: 0.4, fontFace: t.head, fontSize: 17, color: t.text, margin: 0 });
                slide.addText(st.text, { x: area.x + 1.0, y: y + 0.65, w: area.w - 1.0, h: Math.max(0.3, rowH - 0.7), fontFace: t.body, fontSize: textPt, color: t.muted, valign: 'top', margin: 0 });
            });
            break;
        }
        case 'timeline': {
            const top = header(slide, c, area, title, s.subtitle);
            const steps = s.steps ?? [];
            if (area.panel) {
                // Beside a picture: a vertical line with a numbered square per step.
                const rowH = (bottom - top) / steps.length;
                slide.addShape(pptx.ShapeType.line, { x: area.x + 0.2, y: top + 0.15, w: 0, h: bottom - top - rowH * 0.5, line: { color: t.line, width: 2 } });
                steps.forEach((st, i) => {
                    const y = top + i * rowH;
                    const color = t.accents[i % t.accents.length]!;
                    slide.addShape(pptx.ShapeType.rect, { x: area.x, y, w: 0.4, h: 0.4, fill: { color }, line: { type: 'none' } });
                    slide.addText(String(i + 1), { x: area.x, y, w: 0.4, h: 0.4, fontFace: t.tag, fontSize: 13, bold: true, color: ink(color), align: 'center', valign: 'middle', margin: 0 });
                    slide.addText(st.label ?? '', { x: area.x + 0.65, y: y - 0.02, w: area.w - 0.65, h: 0.4, fontFace: t.head, fontSize: 17, color: t.text, margin: 0 });
                    slide.addText(st.text, { x: area.x + 0.65, y: y + 0.4, w: area.w - 0.65, h: Math.max(0.3, rowH - 0.5), fontFace: t.body, fontSize: fitFont([st.text], area.w - 0.65, rowH - 0.5, 14, 10, 0), color: t.muted, valign: 'top', margin: 0 });
                });
                break;
            }
            const textW = Math.min(2.6, area.w / steps.length - 0.15);
            const x0 = area.x + textW / 2;
            const span = area.w - textW;
            const lineY = top + (bottom - top) * 0.38;
            slide.addShape(pptx.ShapeType.line, { x: x0, y: lineY, w: span, h: 0, line: { color: t.line, width: 3 } });
            const stepW = span / Math.max(1, steps.length - 1);
            const textPt = Math.min(...steps.map((st) => fitFont([st.text], textW, 2.2, 15, 11, 0)));
            steps.forEach((st, i) => {
                const cx = x0 + i * stepW;
                const color = t.accents[i % t.accents.length]!;
                slide.addShape(pptx.ShapeType.ellipse, { x: cx - 0.2, y: lineY - 0.2, w: 0.4, h: 0.4, fill: { color }, line: { color: t.bg, width: 3 } });
                slide.addText(st.label ?? '', { x: cx - textW / 2, y: lineY - 1.0, w: textW, h: 0.6, fontFace: t.head, fontSize: 18, color: t.text, align: 'center', valign: 'bottom', margin: 0 });
                slide.addText(st.text, { x: cx - textW / 2, y: lineY + 0.4, w: textW, h: bottom - lineY - 0.5, fontFace: t.body, fontSize: textPt, color: t.muted, align: 'center', valign: 'top', margin: 0 });
            });
            break;
        }
        case 'table': {
            const top = header(slide, c, area, title, s.subtitle);
            const table = s.table!;
            const cols = table.columns.length;
            const firstW = Math.min(3, area.w * 0.24);
            const colW = [firstW, ...Array(cols - 1).fill((area.w - firstW) / (cols - 1))];
            const rowH = Math.min(1.15, (bottom - top - 0.5) / table.rows.length);
            const cellPt = Math.min(...table.rows.flatMap((row) => row.map((cell, k) => fitFont([cell], colW[k]! - 0.2, rowH - 0.15, 16, 11, 0))));
            const border = (bottomColor: string) => [{ type: 'none' as const }, { type: 'none' as const }, { type: 'solid' as const, pt: 0.75, color: bottomColor }, { type: 'none' as const }];
            const head = table.columns.map((col) => ({ text: col.toUpperCase(), options: { fontFace: t.tag, fontSize: 11, bold: true, color: t.muted, border: border(t.text) } }));
            const body = table.rows.map((row, r) =>
                row.map((cell, k) => ({
                    text: cell,
                    options: k === 0 ? { fontFace: t.head, fontSize: cellPt, bold: true, color: t.accents[r % t.accents.length], border: border(t.line) } : { fontFace: t.body, fontSize: cellPt, color: t.text, border: border(t.line) },
                })),
            );
            slide.addTable([head, ...body] as never, { x: area.x, y: top, w: area.w, colW, rowH: [0.45, ...table.rows.map(() => rowH)], valign: 'middle', margin: [4, 10, 4, 0] as never, autoPage: false });
            break;
        }
        case 'gallery': {
            const top = header(slide, c, area, title, s.subtitle);
            const items = s.gallery ?? [];
            const gap = 0.35;
            const gw = (area.w - gap * (items.length - 1)) / items.length;
            const ph = Math.min(2.6, (bottom - top) * 0.52);
            const textPt = Math.min(...items.map((g) => fitFont([g.text], gw, bottom - top - ph - 0.75, 14, 10, 0)));
            for (const [i, g] of items.entries()) {
                const x = area.x + i * (gw + gap);
                await picture(slide, c, g.image, g.imageNote, g.credit, x, top, gw, ph);
                slide.addText(g.heading, { x, y: top + ph + 0.3, w: gw, h: 0.45, fontFace: t.head, fontSize: 17, color: t.accents[i % t.accents.length], margin: 0 });
                slide.addText(g.text, { x, y: top + ph + 0.78, w: gw, h: bottom - top - ph - 0.8, fontFace: t.body, fontSize: textPt, color: t.muted, valign: 'top', margin: 0 });
            }
            break;
        }
        case 'big_number': {
            const top = header(slide, c, area, title, s.subtitle);
            const y = top + 0.2;
            slide.addText(s.number ?? '', { x: area.x, y, w: area.w, h: 1.9, fontFace: t.head, fontSize: area.panel ? 88 : 110, color: t.accents[0], margin: 0 });
            const label = s.label ?? '';
            const labelPt = fitFont([label], area.w, 1.0, 26, 18, 0, 0.55);
            const labelH = textHeight([label], area.w, labelPt, 0, 0.55) + 0.1;
            slide.addText(label, { x: area.x, y: y + 1.95, w: area.w, h: labelH, fontFace: t.head, fontSize: labelPt, color: t.text, valign: 'top', margin: 0 });
            if (s.detail) {slide.addText(s.detail, { x: area.x, y: y + 2.05 + labelH, w: Math.min(10, area.w), h: Math.max(0.6, bottom - y - 2.15 - labelH), fontFace: t.body, fontSize: 16, color: t.muted, valign: 'top', margin: 0 });}
            break;
        }
        case 'chart': {
            const top = header(slide, c, area, title, s.subtitle);
            const ch = s.chart!;
            const type = ch.type === 'line' ? pptx.ChartType.line : ch.type === 'pie' ? pptx.ChartType.pie : ch.type === 'doughnut' ? pptx.ChartType.doughnut : pptx.ChartType.bar;
            const round = ch.type === 'pie' || ch.type === 'doughnut';
            const chartW = s.takeaway ? area.w * 0.62 : area.w;
            const colors = [...t.accents, t.muted];
            slide.addChart(
                type,
                ch.series.map((ser) => ({ name: ser.name, labels: ch.categories, values: ser.values })),
                {
                    x: area.x,
                    y: top,
                    w: chartW,
                    h: bottom - top - 0.35,
                    barDir: ch.type === 'bar' ? 'bar' : 'col',
                    chartColors: round ? colors.concat(colors).slice(0, ch.categories.length) : colors.slice(0, ch.series.length),
                    showValue: !round,
                    showPercent: round,
                    dataLabelColor: round ? 'FFFFFF' : t.text,
                    dataLabelFontSize: 12,
                    dataLabelFontFace: t.body,
                    catAxisLabelColor: t.muted,
                    catAxisLabelFontSize: 12,
                    catAxisLabelFontFace: t.body,
                    valAxisLabelColor: t.muted,
                    valAxisLabelFontSize: 11,
                    valGridLine: { color: t.line, size: 0.75 },
                    catGridLine: { style: 'none' },
                    catAxisLineShow: false,
                    valAxisLineShow: false,
                    barGapWidthPct: 60,
                    holeSize: 60,
                    showLegend: round || ch.series.length > 1,
                    legendPos: 'b',
                    legendColor: t.muted,
                    legendFontSize: 12,
                    legendFontFace: t.body,
                },
            );
            if (s.takeaway) {
                const x = area.x + chartW + 0.4;
                const w = area.w - chartW - 0.4;
                card(slide, c, x, top + 0.3, w, 3.4, t.accents[0]);
                slide.addText(s.takeaway, { x: x + 0.3, y: top + 0.6, w: w - 0.6, h: 2.9, fontFace: t.head, fontSize: fitFont([s.takeaway], w - 0.6, 2.9, 22, 14, 0), color: t.text, valign: 'top', margin: 0 });
            }
            break;
        }
        case 'quote': {
            slide.addText('“', { x: area.x, y: 0.7, w: 2, h: 1.8, fontFace: 'Georgia', fontSize: 140, color: t.accents[0], margin: 0 });
            const q = s.quote ?? '';
            slide.addText(q, { x: area.x + 0.1, y: 2.3, w: area.w - 0.2, h: 3.0, fontFace: t.head, fontSize: fitFont([q], area.w - 0.2, 3.0, 32, 18, 0), color: t.text, valign: 'top', margin: 0 });
            if (s.by) {slide.addText(`— ${s.by}`, { x: area.x + 0.1, y: 5.45, w: area.w - 0.2, h: 0.6, fontFace: t.body, fontSize: 16, color: t.muted, margin: 0 });}
            break;
        }
        case 'image': {
            const top = header(slide, c, area, title, s.subtitle);
            await picture(slide, c, s.image, s.imageNote, s.credit, area.x, top, area.w, bottom - top - (s.caption ? 0.6 : 0.25));
            if (s.caption) {slide.addText(s.caption, { x: area.x, y: bottom - 0.45, w: area.w, h: 0.4, fontFace: t.body, fontSize: 13, color: t.muted, margin: 0 });}
            break;
        }
        case 'takeaways': {
            const top = header(slide, c, area, title, s.subtitle);
            const points = s.points ?? [];
            const rowH = Math.min(1.05, (bottom - top) / Math.max(1, points.length));
            const pt = Math.min(...points.map((p) => fitFont([p], area.w - 1.0, rowH - 0.15, 20, 13, 0)));
            points.forEach((p, i) => {
                const y = top + i * rowH;
                const color = t.accents[i % t.accents.length]!;
                slide.addText(String(i + 1).padStart(2, '0'), { x: area.x, y, w: 0.7, h: rowH - 0.1, fontFace: t.head, fontSize: 24, color, valign: 'top', margin: 0 });
                slide.addText(p, { x: area.x + 0.9, y: y + 0.05, w: area.w - 0.9, h: rowH - 0.1, fontFace: t.body, fontSize: pt, color: t.text, valign: 'top', margin: 0 });
            });
            break;
        }
        case 'closing': {
            const w = area.w;
            slide.addText(title, { x: area.x, y: 1.3, w, h: 3.2, fontFace: t.head, fontSize: fitFont([title], w, 3.2, 46, 26, 0, 0.5), color: t.text, valign: 'bottom', margin: 0 });
            if (s.subtitle) {slide.addText(s.subtitle, { x: area.x, y: 4.75, w, h: 0.8, fontFace: t.head, fontSize: 30, color: t.accents[0], margin: 0 });}
            if (s.detail) {slide.addText(s.detail, { x: area.x, y: 5.6, w, h: 0.9, fontFace: t.body, fontSize: 15, color: t.muted, valign: 'top', margin: 0 });}
            break;
        }
        case 'sources': {
            const top = header(slide, c, area, title || 'Sources');
            const items = s.items ?? [];
            const pt = fitFont(items, area.w, bottom - top, 15, 10, 0.08);
            slide.addText(
                // Each source its own paragraph: without breakLine PptxGenJS runs them together into one.
                items.map((it, i) => ({ text: it, options: { paraSpaceAfter: 6, breakLine: i < items.length - 1 } })),
                { x: area.x, y: top, w: area.w, h: bottom - top, fontFace: t.body, fontSize: pt, color: t.muted, valign: 'top', margin: 0 },
            );
            break;
        }
    }
    if (s.callout && s.layout !== 'title' && s.layout !== 'closing') {
        callout(slide, c, area, s.callout);
    }
    if (s.source && s.layout !== 'sources') {
        slide.addText(`Source: ${s.source}`, { x: area.x, y: BOTTOM - 0.02, w: area.w, h: 0.28, fontFace: t.body, fontSize: 9, color: t.muted, margin: 0 });
    }
    if (s.layout !== 'title' && s.layout !== 'closing') {footer(slide, c, area, spec.title, n);}
    if (s.notes) {slide.addNotes(s.notes);}
}

/** Builds the deck; returns the file bytes and what had no picture. */
export async function buildDeck(spec: DeckSpec, root: string, deckDir?: string): Promise<{ bytes: Uint8Array; missing: string[] }> {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.title = spec.title;
    pptx.subject = spec.subtitle ?? spec.title;
    const t = THEMES[spec.theme ?? 'workshop'];
    pptx.theme = { headFontFace: t.head, bodyFontFace: t.body };
    const c: Ctx = { pptx, t, roots: deckDir && path.resolve(deckDir) !== path.resolve(root) ? [deckDir, root] : [root], missing: [] };
    for (const [i, s] of spec.slides.entries()) {
        await drawSlide(c, spec, s, i + 1);
    }
    const out = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
    return { bytes: new Uint8Array(out), missing: c.missing };
}

// ---------------------------------------------------------------- the tool

const STRINGS = { type: 'array', items: { type: 'string' } };
const COLUMN = { type: 'object', properties: { heading: { type: 'string' }, points: STRINGS }, required: ['heading', 'points'] };

export function makeDeckTool(look?: VisualReview): Tool<DeckSpec> {
    return {
        name: 'make_deck',
        description: [
            'Build a PowerPoint deck (.pptx, plus a PDF copy) from an outline, in the style of decks made with Gamma: you write what each slide says, tested layouts make it look designed. Use this for every presentation; never write python-pptx or matplotlib code for slides.',
            `Layouts: title (title, subtitle, label as a small tag, detail as a tagline, image fills the left side), bullets (points, up to ${LIMITS.points}), cards (2-4: heading, text, icon), two_columns (left and right: heading + points, for a comparison), steps (2-6: heading, text, optional label; numbered rows with dividers), timeline (3-6 steps: label such as a year, text), table (columns, rows of cells), big_number (number, label, detail, source), chart (chart: type bar|column|line|pie|doughnut, categories, series of {name, values}; takeaway; source), gallery (2-4: heading, text, image), quote (quote, by), image (image, caption), takeaways (points), closing (title as the closing statement, subtitle such as "Thank you", detail), sources (items).`,
            'Any slide: subtitle is a short tag shown above the title ("WHY IT MATTERS"); image (a file from find_image, with credit) or imageNote fills one side of bullets, cards, steps, timeline, big_number, quote, takeaways and closing slides, edge to edge (imageSide left or right); callout is the one line to remember, in a bar at the bottom ("Final thought: …"); notes are for the speaker.',
            `Icons for cards: ${ICON_NAMES.join(', ')}.`,
            'Themes: workshop (white, blue title slide; default), editorial (dark charcoal, serif titles, copper), terminal (black, mono titles), midnight, ember (dark), ivory, forest, ocean (light).',
            'Charts and big numbers need real figures with their source; if you have none, use cards or two_columns. It returns the file check and, when available, a review of the rendered slides: fix what it lists by changing the outline and calling make_deck again.',
        ].join(' '),
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'The .pptx to write, e.g. presentations/ai-debate.pptx' },
                title: { type: 'string', description: 'The deck title, shown on the title slide and in every footer' },
                subtitle: { type: 'string' },
                theme: { type: 'string', enum: THEME_NAMES },
                slides: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            layout: { type: 'string', enum: [...LAYOUTS] },
                            title: { type: 'string' },
                            subtitle: { type: 'string', description: 'A short tag above the title; on title and closing slides the line under it' },
                            points: STRINGS,
                            left: COLUMN,
                            right: COLUMN,
                            cards: {
                                type: 'array',
                                items: { type: 'object', properties: { heading: { type: 'string' }, text: { type: 'string' }, icon: { type: 'string', description: 'One of the icon names' }, label: { type: 'string' } }, required: ['heading', 'text'] },
                            },
                            steps: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, heading: { type: 'string' }, text: { type: 'string' } }, required: ['text'] } },
                            table: { type: 'object', properties: { columns: STRINGS, rows: { type: 'array', items: STRINGS } }, required: ['columns', 'rows'] },
                            gallery: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: { heading: { type: 'string' }, text: { type: 'string' }, image: { type: 'string' }, imageNote: { type: 'string' }, credit: { type: 'string' } },
                                    required: ['heading', 'text'],
                                },
                            },
                            number: { type: 'string', description: 'e.g. "40%" or "1.2 bn"' },
                            label: { type: 'string' },
                            detail: { type: 'string' },
                            chart: {
                                type: 'object',
                                properties: {
                                    type: { type: 'string', enum: ['bar', 'column', 'line', 'pie', 'doughnut'] },
                                    categories: STRINGS,
                                    series: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, values: { type: 'array', items: { type: 'number' } } }, required: ['name', 'values'] } },
                                },
                                required: ['type', 'categories', 'series'],
                            },
                            takeaway: { type: 'string' },
                            source: { type: 'string', description: 'Where the figures come from (required for chart and big_number)' },
                            quote: { type: 'string' },
                            by: { type: 'string' },
                            image: { type: 'string', description: 'A picture file in the project, e.g. one saved by find_image' },
                            imageNote: { type: 'string', description: 'What the picture should show, when there is no file yet' },
                            imageSide: { type: 'string', enum: ['left', 'right'] },
                            credit: { type: 'string' },
                            caption: { type: 'string' },
                            callout: { type: 'string', description: 'The one line to remember, shown in a bar at the bottom' },
                            items: STRINGS,
                            notes: { type: 'string', description: 'Speaker notes' },
                        },
                        required: ['layout'],
                    },
                },
            },
            required: ['path', 'title', 'slides'],
        },
        kind: 'write',
        normalize: (args) => repairDeck(args),
        label: (a, ws) => `Build ${displayPath(ws, ws.resolve(a.path))} (${a.slides?.length ?? 0} slides)`,
        paths: (a, ws) => [ws.resolve(a.path)],
        async prepare(args, ctx) {
            const file = ctx.workspace.resolve(args.path.endsWith('.pptx') ? args.path : `${args.path}.pptx`);
            const { errors, advice } = deckProblems(args);
            if (errors.length) {
                return toolError(`Not built. Fix the outline and call make_deck again:\n${errors.map((e) => `- ${e}`).join('\n')}`);
            }
            return {
                run: async () => {
                    const shown = displayPath(ctx.workspace, file);
                    const { bytes, missing } = await buildDeck(args, ctx.workspace.root, path.dirname(file));
                    await mkdir(path.dirname(file), { recursive: true });
                    await writeFile(file, bytes);
                    const lines = [`Built ${shown}: ${args.slides.length} slides (${args.slides.map((s) => s.layout).join(', ')}).`];
                    const report = checkPptx(bytes);
                    lines.push(report.problems.length ? `File check:\n${report.problems.map((p) => `- ${p}`).join('\n')}` : 'File check: no layout problems.');
                    const rendered = await renderToPdf(file, ctx.signal);
                    if ('error' in rendered) {
                        lines.push(`No PDF copy: ${rendered.error}`);
                    } else {
                        const pdf = file.replace(/\.pptx$/i, '.pdf');
                        if (path.resolve(rendered.pdf) !== path.resolve(pdf)) {
                            await copyFile(rendered.pdf, pdf);
                        }
                        lines.push(`PDF copy: ${displayPath(ctx.workspace, pdf)} (exported with ${rendered.via}).`);
                        if (look) {
                            let review: string | undefined;
                            let why = 'no Gemini key is set';
                            try {
                                review = await look(new Uint8Array(await readFile(pdf)), path.basename(file), ctx.signal);
                            } catch (e) {
                                why = e instanceof Error ? e.message : String(e);
                            }
                            lines.push(
                                review?.trim()
                                    ? `How it looks, slide by slide:\n${review.trim()}`
                                    : `Not looked at visually: ${why}. Say so to the user; the file check above still ran.`,
                            );
                        }
                    }
                    if (missing.length) {
                        lines.push(`Slides still needing a picture (labelled frames drawn): ${missing.join('; ')}. Try find_image, or tell the user which slides need one.`);
                    }
                    if (advice.length) {
                        lines.push(`Worth improving:\n${advice.map((a) => `- ${a}`).join('\n')}`);
                    }
                    lines.push('To change anything, edit the outline and call make_deck again; never edit the .pptx by hand.');
                    return { content: lines.join('\n\n'), summary: `${args.slides.length} slides` };
                },
            };
        },
    };
}
