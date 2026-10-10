import 'server-only';
import { bestMatches, type ModelRouter } from '@agentic/core';
import { store } from './kv';
import { fetchEntries, fetchMeta, parseRepo } from './github';
import { REFERENCE_SEED } from './reference-seed';

/**
 * The reference library: what strong solutions of a kind look like, condensed
 * once from a reference project, website or document into a few reusable
 * rules. The extension downloads the library with its daily config and picks
 * the entries that fit a task on the user's machine, so nothing about the
 * user's request ever comes here. Fyxable uses the design entries directly.
 */

export type ReferenceKind = 'blueprint' | 'design' | 'docs';

export interface Reference {
    id: string;
    kind: ReferenceKind;
    name: string;
    /** Words that, found in a request or its documents, make this entry relevant. */
    tags: string[];
    /** The reusable rules, each a sentence or two. */
    points: string[];
    /** Where it was condensed from (a URL, or "pasted text"). */
    source: string;
    addedAt: number;
    enabled: boolean;
}

const KEY = 'pb:references:v1';
const TEN_YEARS = 10 * 365 * 24 * 60 * 60;
export const MAX_REFERENCES = 300;
const MAX_POINTS = 12;
const MAX_POINT = 400;
const MAX_TAGS = 24;
const KINDS: ReferenceKind[] = ['blueprint', 'design', 'docs'];

function clean(text: unknown, max: number): string {
    return typeof text === 'string' ? text.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** Anything malformed is dropped rather than half-kept: this text reaches the agent's instructions. */
export function sanitizeReference(raw: unknown): Reference | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const r = raw as Record<string, unknown>;
    const kind = KINDS.includes(r.kind as ReferenceKind) ? (r.kind as ReferenceKind) : undefined;
    const name = clean(r.name, 120);
    const id = clean(r.id, 60).replace(/[^\w-]/g, '').toLowerCase();
    const tags = (Array.isArray(r.tags) ? r.tags : [])
        .map((t) => clean(t, 40).toLowerCase())
        .filter((t) => t.length >= 2)
        .slice(0, MAX_TAGS);
    const points = (Array.isArray(r.points) ? r.points : [])
        .map((p) => clean(p, MAX_POINT))
        .filter((p) => p.length >= 8)
        .slice(0, MAX_POINTS);
    if (!kind || !name || !id || !tags.length || !points.length) return undefined;
    return {
        id,
        kind,
        name,
        tags: [...new Set(tags)],
        points,
        source: clean(r.source, 300) || 'pasted text',
        addedAt: Number(r.addedAt) || Date.now(),
        enabled: r.enabled !== false,
    };
}

export async function readReferences(): Promise<Reference[]> {
    const [raw] = await store.getMany([KEY]);
    if (!raw) return REFERENCE_SEED;
    try {
        return (JSON.parse(raw) as unknown[]).map(sanitizeReference).filter((r): r is Reference => !!r);
    } catch {
        return [];
    }
}

export async function writeReferences(list: Reference[]): Promise<void> {
    await store.put(KEY, JSON.stringify(list.slice(0, MAX_REFERENCES)), TEN_YEARS);
}

/** What the extension downloads: the enabled entries, without where they came from. */
export async function publicReferences(): Promise<Omit<Reference, 'source' | 'enabled' | 'addedAt'>[]> {
    return (await readReferences()).filter((r) => r.enabled).map(({ id, kind, name, tags, points }) => ({ id, kind, name, tags, points }));
}

/** The entries that fit a piece of text, best first. */
export function matchReferences(list: Reference[], text: string, kind: ReferenceKind, limit = 2): Reference[] {
    return bestMatches(
        list.filter((r) => r.enabled && r.kind === kind),
        text,
        (r) => ({ tags: r.tags, name: r.name }),
        limit,
    );
}

// ── Reading a source ─────────────────────────────────────────────────────────

const MAX_SOURCE_CHARS = 60_000;
const IMPORTANT = /(^|\/)(readme|explain|architecture|design)[^/]*\.md$|(^|\/)(program|startup|app|main|index|server|settings|urls|routes?|models?|schema|entities|dbcontext|appdbcontext)\.\w+$|service|controller|middleware|validation|auth|audit|scope|policy|tailwind\.config|globals?\.css|theme|tokens/i;

/** Not this server, not the network it sits on. */
function publicUrl(input: string): URL {
    const url = new URL(input);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only http and https links can be read.');
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|\[?f[cd])/.test(host)) {
        throw new Error('That address is not on the public internet.');
    }
    return url;
}

async function readRepo(input: string): Promise<{ text: string; title: string }> {
    const spec = parseRepo(input);
    const meta = await fetchMeta(spec.owner, spec.repo, spec.ref);
    const entries = await fetchEntries(spec.owner, spec.repo, meta.ref);
    const decoder = new TextDecoder();
    const files = entries.filter((e) => e.bytes && e.bytes.length < 200_000);
    const ranked = [...files].sort((a, b) => Number(IMPORTANT.test(b.path)) - Number(IMPORTANT.test(a.path)) || a.path.length - b.path.length);
    const parts = [`Repository ${spec.owner}/${spec.repo}. Files:\n${files.map((f) => f.path).slice(0, 400).join('\n')}`];
    let used = parts[0]!.length;
    for (const file of ranked) {
        const body = decoder.decode(file.bytes).slice(0, 4_000);
        if (used + body.length > MAX_SOURCE_CHARS) break;
        parts.push(`--- ${file.path}\n${body}`);
        used += body.length;
    }
    return { text: parts.join('\n\n'), title: `${spec.owner}/${spec.repo}` };
}

async function readSite(input: string): Promise<{ text: string; title: string }> {
    const url = publicUrl(input);
    const get = async (target: URL) => {
        const response = await fetch(target, { signal: AbortSignal.timeout(12_000), headers: { 'user-agent': 'FreeAgentCoder reference reader' }, redirect: 'follow' });
        if (!response.ok) throw new Error(`${target.hostname} answered ${response.status}.`);
        return (await response.text()).slice(0, 2_000_000);
    };
    const html = await get(url);
    const title = /<title[^>]*>([^<]*)/i.exec(html)?.[1]?.trim() || url.hostname;
    // The styles say most about the design: colours, fonts, spacing and custom properties.
    const sheets = [...html.matchAll(/<link[^>]+rel=["']?stylesheet["']?[^>]*href=["']([^"']+)/gi)].slice(0, 3).map((m) => new URL(m[1]!, url));
    const css = [
        ...[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]!),
        ...(await Promise.all(sheets.map((s) => get(publicUrl(s.href)).catch(() => '')))),
    ].join('\n');
    const count = (re: RegExp) => {
        const tally = new Map<string, number>();
        for (const m of css.matchAll(re)) tally.set(m[1]!.toLowerCase(), (tally.get(m[1]!.toLowerCase()) ?? 0) + 1);
        return [...tally].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([v, n]) => `${v} (${n})`).join(', ');
    };
    const text = html
        .replace(/<(script|style|svg|noscript)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<(h[1-3]|nav|header|footer|section|button|a)\b[^>]*>/gi, '\n[$1] ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n')
        .slice(0, 30_000);
    return {
        title,
        text: [
            `Website ${url.href}, titled "${title}".`,
            `Fonts used: ${count(/font-family\s*:\s*([^;}{]+)/gi) || 'unknown'}`,
            `Colours used: ${count(/(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|oklch\([^)]*\)|hsla?\([^)]*\))/gi) || 'unknown'}`,
            `Custom properties: ${count(/(--[\w-]+)\s*:/g) || 'none'}`,
            `Radii: ${count(/border-radius\s*:\s*([^;}{]+)/gi) || 'unknown'}`,
            `Page structure and text:\n${text}`,
        ].join('\n'),
    };
}

/** Reads a GitHub repository, a web page, or plain text into something a model can condense. */
export async function readSource(input: string): Promise<{ text: string; title: string; source: string }> {
    const trimmed = input.trim();
    if (/^https?:\/\/(www\.)?github\.com\/[\w.-]+\/[\w.-]+/i.test(trimmed) || /^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
        return { ...(await readRepo(trimmed)), source: trimmed };
    }
    if (/^https?:\/\//i.test(trimmed)) return { ...(await readSite(trimmed)), source: trimmed };
    return { text: trimmed.slice(0, MAX_SOURCE_CHARS), title: 'Pasted text', source: 'pasted text' };
}

// ── Condensing ───────────────────────────────────────────────────────────────

const GUIDE: Record<ReferenceKind, string> = {
    blueprint:
        'how this kind of project is put together so it is complete, secure and easy to verify: the folder structure, where each cross-cutting concern (auth, authorization, validation, audit, errors) lives and how it is applied everywhere once, the workflow rules, the data and seed choices, and how the work is proven (tests, demo logins, a requirement-to-code map). Name concrete files, classes, libraries and settings.',
    design:
        'the visual system, so a new site in the same spirit can be designed without copying it: layout and grid, section order and what each section does, type scale and font pairing (name the fonts), the colour palette as hex values with each one\'s role, spacing rhythm, corner radii, shadows, imagery style, motion, and the details that make it feel premium.',
    docs: 'the correct, current way to use this library or API: setup, the key calls with their real names and arguments, defaults that bite, version differences, and the mistakes people make.',
};

export const CONDENSE_SYSTEM = 'You turn reference material into short, reusable engineering or design guidance. You never copy text or code verbatim, and you never invent facts that are not in the material.';

export function condensePrompt(kind: ReferenceKind, title: string, text: string): string {
    return `Material (${title}):\n${text}\n\n---\nWrite ${GUIDE[kind]}

Answer with JSON only, in this shape:
{"name": "what this reference is, in under 8 words", "tags": ["8 to 16 lowercase words or short phrases someone asking for this kind of thing would use, including the stack, the domain and the features"], "points": ["6 to 10 rules, each one or two sentences, specific and reusable"]}`;
}

export function parseCondensed(text: string): { name: string; tags: string[]; points: string[] } | undefined {
    const json = /\{[\s\S]*\}/.exec(text)?.[0];
    if (!json) return undefined;
    try {
        const parsed = JSON.parse(json) as { name?: unknown; tags?: unknown; points?: unknown };
        const ref = sanitizeReference({ ...parsed, id: 'x', kind: 'docs' });
        return ref ? { name: ref.name, tags: ref.tags, points: ref.points } : undefined;
    } catch {
        return undefined;
    }
}

export async function completeText(router: ModelRouter, system: string, user: string, signal: AbortSignal): Promise<string> {
    const events = router.stream({ system, messages: [{ role: 'user', content: user }], tools: [], signal });
    let text = '';
    let next = await events.next();
    while (!next.done) {
        const event = next.value;
        if (event.type === 'text') text += event.delta;
        else if (event.type === 'reset') text = '';
        next = await events.next();
    }
    return next.value.content || text;
}

export function slug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || `ref-${Date.now().toString(36)}`;
}
