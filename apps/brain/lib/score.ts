import 'server-only';
import { store } from './kv';

/**
 * FreeAgentCoder's quality score: 0 to 100, from real daily use.
 *
 * Built only from the anonymous counts people chose to share, and only from
 * regular users: an install that has reported on at least REGULAR_DAYS
 * different days. Installs listed in SCORE_EXCLUDE_INSTALLS (your own, while
 * testing) never count. Nothing about what anyone asked or wrote is used.
 *
 *   Success     35%  tasks that finished, out of those that finished or failed
 *                    (tasks the user stopped are left out)
 *   Accuracy    25%  finished tasks the user did not have to correct
 *   Checked     20%  tasks that changed code and then passed a command
 *   Efficiency  20%  model requests per task: 5 or fewer scores full, 30 or
 *                    more scores nothing
 */

export const REGULAR_DAYS = 3;
const DAY_TTL = 40 * 24 * 60 * 60;
const SEEN_TTL = 30 * 24 * 60 * 60;
const today = (offset = 0) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

export interface QualityCounts {
    tasks: number;
    done: number;
    failed: number;
    corrected: number;
    codeTasks: number;
    verified: number;
    requests: number;
    tokens: number;
}

function excluded(install: string): boolean {
    return (process.env.SCORE_EXCLUDE_INSTALLS ?? '')
        .split(',')
        .map((s) => s.trim())
        .includes(install);
}

/** Notes one more day this install reported, and adds its counts to the score if it is a regular user. */
export async function recordQuality(install: string, counts: QualityCounts): Promise<void> {
    if (excluded(install)) return;
    const day = today();
    if (await store.firstIn(`pb:qday:${install}:${day}`, 2 * 24 * 60 * 60)) {
        await store.addCounts(`pb:qdays:${install}`, { n: 1 }, SEEN_TTL);
    }
    const days = (await store.counts(`pb:qdays:${install}`)).n ?? 0;
    const row = { ...counts } as Record<string, number>;
    await store.addCounts(`pb:quality:all:${day}`, row, DAY_TTL);
    if (days >= REGULAR_DAYS) {
        await Promise.all([store.addCounts(`pb:quality:${day}`, row, DAY_TTL), store.addMember(`pb:quality:users:${day}`, install, DAY_TTL)]);
    }
}

export interface Score {
    score: number | null;
    parts: { name: string; value: number | null; weight: number; detail: string }[];
    tasks: number;
    regularUsers: number;
    requestsPerTask: number | null;
    tokensPerTask: number | null;
    /** Too few tasks to trust the number yet. */
    early: boolean;
    trend: { day: string; score: number | null; tasks: number }[];
}

function compute(c: QualityCounts) {
    const ended = c.done + c.failed;
    const success = ended ? c.done / ended : null;
    const accuracy = c.done ? Math.max(0, 1 - c.corrected / c.done) : null;
    const checked = c.codeTasks ? c.verified / c.codeTasks : null;
    const perTask = c.tasks ? c.requests / c.tasks : null;
    const efficiency = perTask === null ? null : Math.min(1, Math.max(0, (30 - perTask) / 25));
    const parts = [
        { name: 'Success', value: success, weight: 35, detail: `${c.done} of ${ended} finished` },
        { name: 'Accuracy', value: accuracy, weight: 25, detail: `${c.corrected} corrected` },
        { name: 'Checked', value: checked, weight: 20, detail: `${c.verified} of ${c.codeTasks} code changes passed a check` },
        { name: 'Efficiency', value: efficiency, weight: 20, detail: perTask === null ? 'no tasks' : `${perTask.toFixed(1)} requests a task` },
    ];
    const known = parts.filter((p) => p.value !== null);
    const weight = known.reduce((s, p) => s + p.weight, 0);
    const score = weight ? Math.round((known.reduce((s, p) => s + (p.value as number) * p.weight, 0) / weight) * 100) : null;
    return { score, parts, perTask };
}

const add = (a: QualityCounts, b: Record<string, number>): QualityCounts => ({
    tasks: a.tasks + (b.tasks ?? 0),
    done: a.done + (b.done ?? 0),
    failed: a.failed + (b.failed ?? 0),
    corrected: a.corrected + (b.corrected ?? 0),
    codeTasks: a.codeTasks + (b.codeTasks ?? 0),
    verified: a.verified + (b.verified ?? 0),
    requests: a.requests + (b.requests ?? 0),
    tokens: a.tokens + (b.tokens ?? 0),
});
const zero: QualityCounts = { tasks: 0, done: 0, failed: 0, corrected: 0, codeTasks: 0, verified: 0, requests: 0, tokens: 0 };

/** The score over the last `days` days, with a daily trend. */
export async function readScore(days = 30): Promise<Score> {
    let total = zero;
    const users = new Set<string>();
    const trend: Score['trend'] = [];
    for (let i = days - 1; i >= 0; i--) {
        const day = today(i);
        const [counts, members] = await Promise.all([store.counts(`pb:quality:${day}`), store.members(`pb:quality:users:${day}`, 500)]);
        total = add(total, counts);
        members.forEach((m) => users.add(m));
        const dayCounts = add(zero, counts);
        if (i < 14) trend.push({ day, score: dayCounts.tasks ? compute(dayCounts).score : null, tasks: dayCounts.tasks });
    }
    const { score, parts, perTask } = compute(total);
    return {
        score,
        parts: parts.map((p) => ({ ...p, value: p.value === null ? null : Math.round(p.value * 100) })),
        tasks: total.tasks,
        regularUsers: users.size,
        requestsPerTask: perTask === null ? null : Math.round(perTask * 10) / 10,
        tokensPerTask: total.tasks ? Math.round(total.tokens / total.tasks) : null,
        early: total.tasks < 50,
        trend,
    };
}
