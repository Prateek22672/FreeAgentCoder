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
    /** Changed files or passed a check (0.6.2+). */
    worked?: boolean;
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
                ...(typeof o.worked === 'boolean' ? { worked: o.worked } : {}),
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
                        ...(o.worked === undefined ? {} : { worked: o.worked }),
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
    /** Finished, not corrected, and changed files or passed a check (only from 0.6.2+ installs). */
    useful?: number;
    /** Tasks that reported whether they did work. */
    reported?: number;
}

/** Outcome rows grouped by the kind of work, for the Models page: how each role is really doing. */
export interface KindStats {
    kind: string;
    tasks: number;
    completed: number;
    corrected: number;
    paused: number;
    avgSteps: number;
    avgTokens: number;
    avgSeconds: number;
    byModel: { provider: string; model: string; tasks: number; completed: number }[];
}

export function aggregateKinds(
    rows: { kind: string; provider: string; model: string; completed: boolean; corrected: boolean; paused: boolean; steps: number; tokens: number; duration_ms: number }[],
): KindStats[] {
    const by = new Map<string, typeof rows>();
    for (const row of rows) by.set(row.kind, [...(by.get(row.kind) ?? []), row]);
    return [...by.entries()]
        .map(([kind, list]) => {
            const n = list.length;
            const models = new Map<string, { provider: string; model: string; tasks: number; completed: number }>();
            for (const r of list) {
                const key = `${r.provider}:${r.model}`;
                const m = models.get(key) ?? { provider: r.provider, model: r.model, tasks: 0, completed: 0 };
                m.tasks++;
                if (r.completed) m.completed++;
                models.set(key, m);
            }
            return {
                kind,
                tasks: n,
                completed: list.filter((r) => r.completed).length,
                corrected: list.filter((r) => r.corrected).length,
                paused: list.filter((r) => r.paused).length,
                avgSteps: list.reduce((s, r) => s + r.steps, 0) / n,
                avgTokens: list.reduce((s, r) => s + r.tokens, 0) / n,
                avgSeconds: list.reduce((s, r) => s + r.duration_ms, 0) / n / 1000,
                byModel: [...models.values()].filter((m) => m.provider).sort((a, b) => b.tasks - a.tasks).slice(0, 5),
            };
        })
        .sort((a, b) => b.tasks - a.tasks);
}

export async function kindStats(days = 14): Promise<KindStats[]> {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = await select<Parameters<typeof aggregateKinds>[0][number]>(
        `fac_task_outcomes?select=kind,provider,model,completed,corrected,paused,steps,tokens,duration_ms&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=5000`,
    );
    return aggregateKinds(rows);
}

export const listLessons = () => select<LessonRow>('fac_lessons?select=*&order=installs.desc,occurrences.desc&limit=300');
export const listErrors = () => select<ErrorRow>('fac_error_patterns?select=*&status=neq.ignored&order=repeats.desc,occurrences.desc&limit=100');
export const listFyx = () => select<FyxRow>('fac_fyx_patterns?select=*&order=installs.desc,occurrences.desc&limit=200');

export async function modelScores(days = 14): Promise<ModelScore[]> {
    if (!learningAvailable) return [];
    const response = await supabaseRest('rpc/fac_model_scores', { body: { p_days: days } });
    if (!response.ok) throw new Error(`learning: scores HTTP ${response.status}`);
    return ((await response.json()) as ModelScore[]).map((s) => ({
        ...s,
        tasks: Number(s.tasks),
        completed: Number(s.completed),
        corrected: Number(s.corrected),
        good: Number(s.good),
        bad: Number(s.bad),
        ...(s.useful === undefined ? {} : { useful: Number(s.useful), reported: Number(s.reported ?? 0) }),
    }));
}

export async function feedbackSummary(days = 14): Promise<{ good: number; bad: number; reasons: Record<string, number> }> {
    const rows = await select<{ good: boolean; reasons: string[] }>(`fac_feedback?select=good,reasons&created_at=gte.${new Date(Date.now() - days * 86_400_000).toISOString()}&limit=5000`);
    const reasons: Record<string, number> = {};
    for (const r of rows) for (const reason of r.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
    return { good: rows.filter((r) => r.good).length, bad: rows.filter((r) => !r.good).length, reasons };
}

/** A rule drafted from the benchmarks' failing checks: waits in the lessons queue like a user's, for approval. */
export async function proposeLesson(text: string, stack: string): Promise<void> {
    if (!isShareableRule(text)) return;
    await ok(supabaseRest('rpc/fac_learn_lesson', { body: { p_hash: ruleHash(text), p_text: text, p_stack: stack, p_install: 'benchmark' } }), 'lesson');
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

/** The default first choice per tier; a learned order may only displace it on clear evidence. */
export const DEFAULT_FIRST = { fast: 'groq', deep: 'gemini' } as const;
/** How much better (share of useful tasks) a challenger must be to go ahead of the default first choice. */
const MARGIN = 0.1;

/**
 * The share of a provider's tasks that really helped: finished, not corrected
 * by the user's next message, not thumbed down, and (where the install says)
 * changed files or passed a check. A model that "finishes" by telling the user
 * to do it themselves finishes fast and changes nothing, so it scores low.
 */
function usefulShare(list: ModelScore[]): { tasks: number; share: number } {
    let tasks = 0;
    let value = 0;
    for (const s of list) {
        const rated = s.good + s.bad;
        const badShare = rated ? s.bad / rated : 0;
        // Tasks that reported "did work" count by it; older installs count finished-and-not-corrected at half weight.
        const reported = s.reported ?? 0;
        const unreported = s.tasks - reported;
        const knownUseful = s.useful ?? 0;
        const guessUseful = Math.max(0, s.completed - s.corrected) * (s.tasks ? unreported / s.tasks : 0) * 0.5;
        value += knownUseful + guessUseful - badShare * s.tasks * 0.5 - Math.max(0, s.avg_steps - 12) * s.tasks * 0.01;
        tasks += s.tasks;
    }
    return { tasks, share: tasks ? value / tasks : 0 };
}

/**
 * The provider order the outcomes support, per tier. Only providers with
 * enough tasks are ranked, and the ranking is applied only when it is safe:
 * the default first choice must itself have enough tasks to compare, and a
 * challenger goes ahead of it only when it is clearly more useful on twice the
 * minimum evidence. Otherwise the extension keeps its own order.
 */
export function learnedOrder(scores: ModelScore[]): { fast?: string[]; deep?: string[] } {
    const order: { fast?: string[]; deep?: string[] } = {};
    for (const tier of ['fast', 'deep'] as const) {
        const byProvider = new Map<string, ModelScore[]>();
        for (const s of scores.filter((x) => x.tier === tier)) byProvider.set(s.provider, [...(byProvider.get(s.provider) ?? []), s]);
        const ranked = [...byProvider]
            .map(([provider, list]) => ({ provider, ...usefulShare(list) }))
            .filter((p) => p.tasks >= MIN_TASKS && p.provider !== 'openrouter' && p.provider !== 'trial')
            .sort((a, b) => b.share - a.share);
        const first = ranked.find((p) => p.provider === DEFAULT_FIRST[tier]);
        if (ranked.length < 2 || !first) continue;
        const top = ranked[0]!;
        if (top.provider !== first.provider && (top.share - first.share < MARGIN || top.tasks < MIN_TASKS * 2)) {
            // Not clear enough to overturn the default: keep it first, rank the rest after it.
            order[tier] = [first.provider, ...ranked.filter((p) => p !== first).map((p) => p.provider)];
        } else {
            order[tier] = ranked.map((p) => p.provider);
        }
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
