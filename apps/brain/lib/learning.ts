import 'server-only';
import { createHash } from 'node:crypto';
import { supabaseAvailable, supabaseRest } from './kv';

/**
 * Fleet learning: what installs that chose "OK, start using the agent" share,
 * kept in the Supabase tables of supabase/learning.sql. Never code, file
 * contents or prompts: general lessons, normalised error patterns, task
 * outcomes and ratings, and Fyx chores with names removed. Everything is
 * checked and capped here again, whatever the extension already did.
 *
 * What the admin approves goes back to every install in the daily config:
 * shared lessons, Fyx patterns, and the model order the outcomes support.
 */

export const learningAvailable = supabaseAvailable;

export interface Outcome {
    kind: string;
    tier: 'fast' | 'deep';
    provider: string;
    model: string;
    completed: boolean;
    corrected: boolean;
    steps: number;
    tokens: number;
    durationMs: number;
    paused: boolean;
    repeatedErrors: number;
}

export interface Feedback {
    kind: string;
    provider: string;
    model: string;
    good: boolean;
    reasons: string[];
}

export interface LearningReport {
    install: string;
    extension: string;
    outcomes: Outcome[];
    feedback: Feedback[];
    lessons: { text: string; stack: string }[];
    errors: { signature: string; tool: string; stack: string; count: number; repeats: number }[];
    fyx: { pattern: string; command: string }[];
}

const ID = /^[a-f0-9-]{8,64}$/i;
const SLUG = /^[a-z0-9][a-z0-9._:/-]{0,79}$/i;
export const REASONS = ['did-not-run', 'ignored-request', 'too-slow', 'looks-bad', 'wrong-answer', 'too-many-tokens'];

const num = (v: unknown, max: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
};
const slug = (v: unknown, max = 80) => (typeof v === 'string' && SLUG.test(v.trim()) ? v.trim().slice(0, max) : '');
const text = (v: unknown, max: number) =>
    typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

/**
 * A rule that could only be about one person's project is not shared: paths
 * with folders, addresses, emails, anything that looks like a key or a long
 * number. What remains is the kind of rule every user benefits from.
 */
export function isShareableRule(rule: string): boolean {
    if (rule.length < 12 || rule.length > 240) return false;
    return !(
        /[\w.-]+[\\/][\w.-]+[\\/]/.test(rule) ||
        /[a-z]:\\|~\//i.test(rule) ||
        /https?:\/\/|www\./i.test(rule) ||
        /[\w.+-]+@[\w-]+\.[\w.]+/.test(rule) ||
        /\b[A-Za-z0-9_-]{24,}\b/.test(rule) ||
        /\d{6,}/.test(rule) ||
        /\b(password|secret|token|api[_ -]?key)\s*[:=]/i.test(rule)
    );
}

/** A chore pattern: words and {placeholders} only, and a command made of the same. */
export function isShareablePattern(pattern: string, command: string): boolean {
    return (
        /^[a-z0-9 {}'"._-]{3,80}$/i.test(pattern) &&
        command.length > 1 &&
        command.length <= 160 &&
        !/[\\/]{2}|https?:|@|\b[A-Za-z0-9_-]{24,}\b/.test(command) &&
        // Every name the user chose was replaced: what is left of the command is the tool and its flags.
        command.split(/\s+/).every((w) => /^(?:\{\w+\}|[-\w.=:,])+$/.test(w) && !/[A-Z]{2,}\d/.test(w))
    );
}

/** Returns the report only if every field is the shape it should be; anything else is dropped. */
export function parseLearning(body: unknown): LearningReport | undefined {
    if (!body || typeof body !== 'object') return undefined;
    const raw = body as Record<string, unknown>;
    const install = typeof raw.install === 'string' && ID.test(raw.install) ? raw.install.toLowerCase() : '';
    if (!install || Number(raw.v) !== 1) return undefined;
    const list = (value: unknown, max: number) => (Array.isArray(value) ? value.slice(0, max) : []) as Record<string, unknown>[];
    const outcomes: Outcome[] = list(raw.outcomes, 50).flatMap((o) => {
        const tier = o.tier === 'fast' ? 'fast' : o.tier === 'deep' ? 'deep' : undefined;
        if (!tier) return [];
        return [
            {
                kind: slug(o.kind, 30) || 'other',
                tier,
                provider: slug(o.provider, 30),
                model: slug(o.model),
                completed: o.completed === true,
                corrected: o.corrected === true,
                steps: num(o.steps, 1_000),
                tokens: num(o.tokens, 50_000_000),
                durationMs: num(o.durationMs, 24 * 3_600_000),
                paused: o.paused === true,
                repeatedErrors: num(o.repeatedErrors, 1_000),
            },
        ];
    });
    const feedback: Feedback[] = list(raw.feedback, 50).flatMap((f) =>
        typeof f.good === 'boolean'
            ? [
                  {
                      kind: slug(f.kind, 30) || 'other',
                      provider: slug(f.provider, 30),
                      model: slug(f.model),
                      good: f.good,
                      reasons: (Array.isArray(f.reasons) ? f.reasons : []).filter((r): r is string => typeof r === 'string' && REASONS.includes(r)).slice(0, 6),
                  },
              ]
            : [],
    );
    const lessons = list(raw.lessons, 20).flatMap((l) => {
        const rule = text(l.text, 240);
        return isShareableRule(rule) ? [{ text: rule, stack: slug(l.stack, 40) }] : [];
    });
    const errors = list(raw.errors, 50).flatMap((e) => {
        const signature = text(e.signature, 200);
        return signature.length >= 8 && isShareableRule(signature.replace(/<path>/g, 'path'))
            ? [{ signature, tool: slug(e.tool, 30), stack: slug(e.stack, 40), count: num(e.count, 1_000) || 1, repeats: num(e.repeats, 1_000) }]
            : [];
    });
    const fyx = list(raw.fyx, 20).flatMap((f) => {
        const pattern = text(f.pattern, 80).toLowerCase();
        const command = text(f.command, 160);
        return isShareablePattern(pattern, command) ? [{ pattern, command }] : [];
    });
    return { install, extension: slug(raw.extension, 20) || 'unknown', outcomes, feedback, lessons, errors, fyx };
}

export function ruleHash(rule: string): string {
    return createHash('sha256').update(rule.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).digest('hex').slice(0, 32);
}

async function ok(response: Promise<Response>, what: string): Promise<void> {
    const r = await response;
    if (!r.ok) throw new Error(`learning: ${what} HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 160)}`);
}

export async function recordLearning(report: LearningReport): Promise<void> {
    if (!learningAvailable) return;
    const writes: Promise<void>[] = [];
    if (report.outcomes.length) {
        writes.push(
            ok(
                supabaseRest('fac_task_outcomes', {
                    body: report.outcomes.map((o) => ({
                        install: report.install,
                        extension: report.extension,
                        kind: o.kind,
                        tier: o.tier,
                        provider: o.provider,
                        model: o.model,
                        completed: o.completed,
                        corrected: o.corrected,
                        steps: o.steps,
                        tokens: o.tokens,
                        duration_ms: o.durationMs,
                        paused: o.paused,
                        repeated_errors: o.repeatedErrors,
                    })),
                    headers: { prefer: 'return=minimal' },
                }),
                'outcomes',
            ),
        );
    }
    if (report.feedback.length) {
        writes.push(
            ok(
                supabaseRest('fac_feedback', {
                    body: report.feedback.map((f) => ({ install: report.install, kind: f.kind, provider: f.provider, model: f.model, good: f.good, reasons: f.reasons })),
                    headers: { prefer: 'return=minimal' },
                }),
                'feedback',
            ),
        );
    }
    for (const l of report.lessons) {
        writes.push(ok(supabaseRest('rpc/fac_learn_lesson', { body: { p_hash: ruleHash(l.text), p_text: l.text, p_stack: l.stack, p_install: report.install } }), 'lesson'));
    }
    for (const e of report.errors) {
        writes.push(
            ok(supabaseRest('rpc/fac_learn_error', { body: { p_signature: e.signature, p_tool: e.tool, p_stack: e.stack, p_count: e.count, p_repeats: e.repeats } }), 'error'),
        );
    }
    for (const f of report.fyx) {
        writes.push(ok(supabaseRest('rpc/fac_learn_fyx', { body: { p_pattern: f.pattern, p_command: f.command, p_install: report.install } }), 'fyx'));
    }
    await Promise.all(writes);
}

// ── Reading, for the admin page and the daily config ─────────────────────────

async function select<T>(path: string): Promise<T[]> {
    if (!learningAvailable) return [];
    const response = await supabaseRest(path);
    if (!response.ok) throw new Error(`learning: ${path.split('?')[0]} HTTP ${response.status} ${(await response.text().catch(() => '')).slice(0, 160)}`);
    return (await response.json()) as T[];
}

export interface LessonRow {
    hash: string;
    text: string;
    stack: string;
    status: 'pending' | 'approved' | 'rejected';
    occurrences: number;
    installs: number;
    last_seen: string;
}
export interface ErrorRow {
    signature: string;
    tool: string;
    stack: string;
    occurrences: number;
    repeats: number;
    last_seen: string;
    draft_rule: string;
    status: 'new' | 'drafted' | 'approved' | 'ignored';
}
export interface FyxRow {
    pattern: string;
    command: string;
    occurrences: number;
    installs: number;
    status: 'pending' | 'approved' | 'rejected';
}
export interface ModelScore {
    tier: 'fast' | 'deep';
    provider: string;
    model: string;
    tasks: number;
    completed: number;
    corrected: number;
    avg_steps: number;
    avg_tokens: number;
    good: number;
    bad: number;
}

export const listLessons = () => select<LessonRow>('fac_lessons?select=*&order=installs.desc,occurrences.desc&limit=300');
export const listErrors = () => select<ErrorRow>('fac_error_patterns?select=*&status=neq.ignored&order=repeats.desc,occurrences.desc&limit=100');
export const listFyx = () => select<FyxRow>('fac_fyx_patterns?select=*&order=installs.desc,occurrences.desc&limit=200');

export async function modelScores(days = 14): Promise<ModelScore[]> {
    if (!learningAvailable) return [];
    const response = await supabaseRest('rpc/fac_model_scores', { body: { p_days: days } });
    if (!response.ok) throw new Error(`learning: scores HTTP ${response.status}`);
    return ((await response.json()) as ModelScore[]).map((s) => ({ ...s, tasks: Number(s.tasks), completed: Number(s.completed), corrected: Number(s.corrected), good: Number(s.good), bad: Number(s.bad) }));
}

export async function feedbackSummary(days = 14): Promise<{ good: number; bad: number; reasons: Record<string, number> }> {
    const rows = await select<{ good: boolean; reasons: string[] }>(`fac_feedback?select=good,reasons&created_at=gte.${new Date(Date.now() - days * 86_400_000).toISOString()}&limit=5000`);
    const reasons: Record<string, number> = {};
    for (const r of rows) for (const reason of r.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
    return { good: rows.filter((r) => r.good).length, bad: rows.filter((r) => !r.good).length, reasons };
}

export async function setLessonStatus(hash: string, status: LessonRow['status'], edited?: string): Promise<void> {
    await ok(supabaseRest(`fac_lessons?hash=eq.${encodeURIComponent(hash)}`, { method: 'PATCH', body: { status, ...(edited ? { text: edited } : {}) } }), 'lesson status');
}
export async function setErrorRule(signature: string, patch: { draft_rule?: string; status?: ErrorRow['status'] }): Promise<void> {
    await ok(supabaseRest(`fac_error_patterns?signature=eq.${encodeURIComponent(signature)}`, { method: 'PATCH', body: patch }), 'error rule');
}
export async function setFyxStatus(pattern: string, status: FyxRow['status']): Promise<void> {
    await ok(supabaseRest(`fac_fyx_patterns?pattern=eq.${encodeURIComponent(pattern)}`, { method: 'PATCH', body: { status } }), 'fyx status');
}

/** Fewer tasks than this and a model's numbers say more about luck than the model. */
export const MIN_TASKS = 20;

/**
 * The provider order the outcomes support, per tier: completed tasks count,
 * corrections and thumbs-down count against, extra steps a little. Only
 * providers with enough tasks are ranked; the extension keeps its own order
 * for the rest, and never puts a weak fallback first.
 */
export function learnedOrder(scores: ModelScore[]): { fast?: string[]; deep?: string[] } {
    const order: { fast?: string[]; deep?: string[] } = {};
    for (const tier of ['fast', 'deep'] as const) {
        const byProvider = new Map<string, { tasks: number; value: number }>();
        for (const s of scores.filter((x) => x.tier === tier)) {
            const p = byProvider.get(s.provider) ?? { tasks: 0, value: 0 };
            const rated = s.good + s.bad;
            const value = s.completed - s.corrected * 0.5 - (rated ? (s.bad / rated) * s.tasks * 0.3 : 0) - Math.max(0, s.avg_steps - 8) * s.tasks * 0.01;
            byProvider.set(s.provider, { tasks: p.tasks + s.tasks, value: p.value + value });
        }
        const ranked = [...byProvider]
            .filter(([provider, p]) => p.tasks >= MIN_TASKS && provider !== 'openrouter' && provider !== 'trial')
            .sort((a, b) => b[1].value / b[1].tasks - a[1].value / a[1].tasks)
            .map(([provider]) => provider);
        if (ranked.length >= 2) order[tier] = ranked;
    }
    return order;
}

/** What every install downloads with its daily config. */
export async function publicLearning(): Promise<{ lessons: { text: string; stack: string }[]; fyx: { pattern: string; command: string }[]; order: { fast?: string[]; deep?: string[] } }> {
    if (!learningAvailable) return { lessons: [], fyx: [], order: {} };
    const [lessons, errors, fyx, scores] = await Promise.all([
        select<{ text: string; stack: string }>('fac_lessons?select=text,stack&status=eq.approved&order=installs.desc&limit=60').catch(() => []),
        select<{ draft_rule: string; stack: string }>('fac_error_patterns?select=draft_rule,stack&status=eq.approved&order=repeats.desc&limit=40').catch(() => []),
        select<{ pattern: string; command: string }>('fac_fyx_patterns?select=pattern,command&status=eq.approved&limit=100').catch(() => []),
        modelScores(14).catch(() => [] as ModelScore[]),
    ]);
    return {
        lessons: [...lessons, ...errors.filter((e) => e.draft_rule).map((e) => ({ text: e.draft_rule, stack: e.stack }))],
        fyx,
        order: learnedOrder(scores),
    };
}
