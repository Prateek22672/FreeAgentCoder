/**
 * The System page's model: every part of FreeAgentCoder's pipeline as a node
 * in a workflow, with its live health computed from the numbers the site
 * already keeps, and an honest note on how it works, where it is strong, where
 * it is weak and what comes next. Pure, so it can be tested.
 */

import type { SystemEvent } from './events';
import type { ModelScore } from './learning';

export type Health = 'ok' | 'warn' | 'down' | 'idle';

export interface SystemNode {
    id: string;
    title: string;
    subtitle: string;
    group: number;
    /** Row inside the group's column, from the top. */
    row: number;
    icon: string;
    health: Health;
    /** One line on the card. */
    metric: string;
    details: { label: string; value: string }[];
    issues: string[];
    how: string;
    strengths: string[];
    weaknesses: string[];
    next: string[];
}

export interface SystemEdge {
    from: string;
    to: string;
    /** A feedback loop, drawn dashed. */
    loop?: boolean;
}

export const GROUPS = [
    { title: '1. Request', note: 'What the user asked, in the editor' },
    { title: '2. Decide', note: 'Fyx, a quick answer, or the agent' },
    { title: '3. Models', note: 'Free providers, keys rotated' },
    { title: '4. Do and check', note: 'Tools, then real checks' },
    { title: '5. Result and learning', note: 'How it went, and what it taught' },
];

export interface SystemInput {
    installs?: number;
    active: { today: number; week: number; month: number };
    versions: { version: string; installs: number }[];
    totals: Record<string, number>;
    daily: { day: string; tasks: number; done: number; failed: number; reports: number }[];
    failures: { cause: string; times: number }[];
    providerInstalls: { provider: string; installs: number }[];
    score: { score: number | null; parts: { name: string; value: number | null; detail: string }[]; tasks: number; tokensPerTask: number | null; requestsPerTask: number | null };
    trial: { enabled: boolean; requests: number; installs: number; refused: number; failed: number; tokens: number; cap: number; bonusTokens: number; bonuses: number };
    pool: { provider: string; enabled: boolean; benched: boolean; state?: string; okToday: number; failedToday: number }[];
    models: ModelScore[];
    feedback: { good: number; bad: number; reasons: Record<string, number> };
    lessons: { pending: number; approved: number };
    errors: { signature: string; tool: string; occurrences: number; repeats: number; status: string }[];
    lab: { runs: number; lastAt?: number; passRate?: number; failing: { title: string; text: string; failed: number; graded: number }[] };
    events: SystemEvent[];
    learningAvailable: boolean;
}

const PROVIDERS: { id: string; title: string; note: string }[] = [
    { id: 'gemini', title: 'Google Gemini', note: 'Complex work: 1M-token context, five Flash models per key' },
    { id: 'groq', title: 'Groq', note: 'Quick work: very fast, small requests' },
    { id: 'nvidia', title: 'NVIDIA NIM', note: 'Nemotron for complex and quick steps' },
    { id: 'openrouter', title: 'OpenRouter', note: 'Free router, last resort' },
    { id: 'mistral', title: 'Mistral', note: 'Optional, Experiment plan' },
    { id: 'trial', title: 'Free trial pool', note: 'The site’s keys, for users with none (and the bonus)' },
];

const n = (value: number) => value.toLocaleString('en-US');
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');

function rate(ok: number, bad: number): Health {
    if (!ok && !bad) return 'idle';
    const share = bad / (ok + bad);
    return share > 0.4 ? 'down' : share > 0.15 ? 'warn' : 'ok';
}

export function buildSystem(input: SystemInput): { nodes: SystemNode[]; edges: SystemEdge[] } {
    const t = input.totals;
    const tasks = t.tasks ?? 0;
    const done = t.done ?? 0;
    const failed = t.failed ?? 0;
    const stopped = t.stopped ?? 0;
    const fyx = t.fyxTasks ?? 0;
    const failuresBy = (prefix: string) => input.failures.filter((f) => f.cause.startsWith(`${prefix}:`));
    const recent = (source: string) => input.events.filter((e) => e.source === source || e.source.startsWith(`${source}:`)).slice(0, 6).map((e) => `${new Date(e.at).toISOString().slice(5, 16).replace('T', ' ')} · ${e.message}`);
    const nodes: SystemNode[] = [];

    nodes.push({
        id: 'editor',
        title: 'VS Code extension',
        subtitle: 'Installs reporting',
        group: 0,
        row: 0,
        icon: 'editor',
        health: input.active.week ? 'ok' : 'idle',
        metric: `${n(input.active.today)} today · ${n(input.active.week)} this week`,
        details: [
            { label: 'Marketplace installs', value: input.installs === undefined ? '—' : n(input.installs) },
            { label: 'Active, 30 days', value: n(input.active.month) },
            { label: 'Versions', value: input.versions.slice(0, 4).map((v) => `${v.version} (${v.installs})`).join(', ') || '—' },
        ],
        issues: input.versions.length > 1 ? [`${input.versions.filter((v) => v !== input.versions[0]).reduce((s, v) => s + v.installs, 0)} reporting installs are not on the newest version yet.`] : [],
        how: 'The chat panel takes the request, attachments and @-mentions, keeps the conversation on the computer, and sends anonymous counts only for installs that chose OK.',
        strengths: ['Everything visible: plan, diffs, commands, undo', 'Chats and keys stay local (CROCS Security)'],
        weaknesses: ['Counts only from installs that opted in, so numbers undercount'],
        next: ['Show the agent’s plan as a live workflow in the chat'],
    });

    nodes.push({
        id: 'intent',
        title: 'Understand the request',
        subtitle: 'Small talk, question, Fyx chore or task',
        group: 1,
        row: 0,
        icon: 'route',
        health: tasks ? 'ok' : 'idle',
        metric: `${n(tasks)} tasks · ${n(fyx)} by Fyx`,
        details: [
            { label: 'Tasks, 14 days', value: n(tasks) },
            { label: 'Done by Fyx (no model)', value: `${n(fyx)} (${pct(fyx, tasks + fyx)})` },
            { label: 'Tokens saved by Fyx', value: n(t.fyxTokensSaved ?? 0) },
        ],
        issues: [],
        how: 'Greetings and general questions get a tiny prompt (about 250 tokens). Chores such as git, zip and dev servers go to Fyx with no model. Everything else is classed quick or complex and gets the method, playbooks and references that fit.',
        strengths: ['Small talk costs ~90% less than before', 'Fyx answers chores in seconds for 0 tokens'],
        weaknesses: ['Word-based classing can misjudge an unusual request'],
        next: ['Learn the class from outcomes, not only from words'],
    });

    const rateLimited = input.failures.filter((f) => /rate|limit|quota|busy/.test(f.cause)).reduce((s, f) => s + f.times, 0);
    nodes.push({
        id: 'router',
        title: 'Key and model router',
        subtitle: 'Rotates keys, falls back, rests limited keys',
        group: 1,
        row: 1,
        icon: 'router',
        health: rate(done, rateLimited / 4),
        metric: `${n(rateLimited)} limit hits handed on`,
        details: [
            { label: 'Rate-limit and quota hits', value: n(rateLimited) },
            { label: 'Top causes', value: input.failures.slice(0, 3).map((f) => `${f.cause} (${f.times})`).join(', ') || 'none' },
        ],
        issues: input.failures.slice(0, 4).map((f) => `${f.cause}: ${f.times} times`),
        how: 'Each step goes to the best ready model for its kind of work. A key that hits a limit rests for the time its provider says (until tomorrow for a daily quota) and the same step moves to the next key or model in about a second, with the conversation intact.',
        strengths: ['Mid-task key switching with no lost context', 'Learned model order from real outcomes'],
        weaknesses: ['When every key is busy it can only wait (up to 90 s)'],
        next: ['Warn earlier when a user’s keys are nearly spent today'],
    });

    PROVIDERS.forEach((p, i) => {
        if (p.id === 'trial') {
            const tr = input.trial;
            const poolKeys = input.pool;
            const healthy = poolKeys.filter((k) => k.enabled && !k.benched && k.state !== 'invalid').length;
            const poolIssues = poolKeys.filter((k) => k.benched || k.state === 'invalid' || k.state === 'limited').map((k) => `${k.provider} key ${k.state === 'invalid' ? 'invalid' : k.benched ? 'benched after failures' : 'limited'}`);
            nodes.push({
                id: 'trial',
                title: p.title,
                subtitle: p.note,
                group: 2,
                row: i,
                icon: 'pool',
                health: !tr.enabled ? 'down' : !healthy ? 'down' : rate(tr.requests, tr.failed + tr.refused / 4),
                metric: `${n(tr.requests)} requests today · ${healthy}/${poolKeys.length} keys ready`,
                details: [
                    { label: 'People today', value: n(tr.installs) },
                    { label: 'Requests today', value: `${n(tr.requests)} of ${n(tr.cap)} cap` },
                    { label: 'Tokens today', value: n(tr.tokens) },
                    { label: 'Turned away / failed', value: `${n(tr.refused)} / ${n(tr.failed)}` },
                    { label: 'Bonuses given today', value: `${n(tr.bonuses)} (${n(tr.bonusTokens)} tokens each)` },
                ],
                issues: [...poolIssues, ...recent('trial'), ...recent('pool')].slice(0, 8),
                how: 'Users with no key (and users whose keys and daily trial are spent, if they claimed the bonus) run on the site’s pool of free keys. Each request tries two keys per provider, up to six, and a limited key rests at once.',
                strengths: ['First task works with no setup', 'Bonus keeps a task going when keys run out'],
                weaknesses: ['Shares the pool’s free quota across everyone', 'Requests pass through the site (not stored)'],
                next: ['More pool keys from different providers as installs grow'],
            });
            return;
        }
        const scores = input.models.filter((m) => m.provider === p.id);
        const ran = scores.reduce((s, m) => s + m.tasks, 0);
        const completed = scores.reduce((s, m) => s + m.completed, 0);
        const fails = failuresBy(p.id);
        const failTimes = fails.reduce((s, f) => s + f.times, 0);
        const holders = input.providerInstalls.find((x) => x.provider === p.id)?.installs ?? 0;
        nodes.push({
            id: p.id,
            title: p.title,
            subtitle: p.note,
            group: 2,
            row: i,
            icon: 'model',
            health: !holders && !ran ? 'idle' : rate(completed || holders, failTimes / 3 + (ran - completed) / 2),
            metric: ran ? `${pct(completed, ran)} of ${n(ran)} tasks finished` : `${n(holders)} installs hold a key`,
            details: [
                { label: 'Installs with a key', value: n(holders) },
                { label: 'Tasks it ended (14 days)', value: ran ? `${n(ran)}, ${pct(completed, ran)} finished` : '—' },
                ...scores.slice(0, 3).map((m) => ({ label: `${m.tier} · ${m.model}`, value: `${m.tasks} tasks, ${m.avg_steps} steps, ${n(Math.round(m.avg_tokens))} tokens` })),
            ],
            issues: fails.slice(0, 4).map((f) => `${f.cause}: ${f.times} times`),
            how: p.note,
            strengths: p.id === 'gemini' ? ['Huge context; every Flash model on a key used before moving on'] : p.id === 'groq' ? ['Fastest replies for quick steps'] : p.id === 'nvidia' ? ['Strong Nemotron models, free'] : ['Free variety when others are busy'],
            weaknesses: p.id === 'groq' ? ['Small per-request size: big tasks move elsewhere'] : p.id === 'openrouter' ? ['Model quality varies by what is idle'] : ['Free-tier limits per day'],
            next: ['Ranked by real outcomes once it has 20+ tasks'],
        });
    });

    const recurring = input.errors.filter((e) => e.repeats > 0);
    nodes.push({
        id: 'tools',
        title: 'Tools',
        subtitle: 'Files, commands, docs, images',
        group: 3,
        row: 0,
        icon: 'tools',
        health: !input.learningAvailable ? 'idle' : recurring.length > 8 ? 'warn' : 'ok',
        metric: `${n(recurring.length)} recurring errors`,
        details: [
            { label: 'Recurring error patterns', value: n(recurring.length) },
            { label: 'With an approved rule', value: n(input.errors.filter((e) => e.status === 'approved').length) },
            { label: 'Worst', value: recurring[0] ? `${recurring[0].tool}: ${recurring[0].signature.slice(0, 60)}` : '—' },
        ],
        issues: recurring.slice(0, 5).map((e) => `${e.tool || 'tool'}: ${e.signature.slice(0, 80)} (${e.occurrences}×, repeated ${e.repeats}×)`),
        how: 'Read, search, edit by line, run commands, live library docs, photos from Wikimedia, all inside the project. Keys and passwords in what tools return are masked before the model sees them.',
        strengths: ['Edits by line number avoid most "not found" retries', 'Secrets masked (CROCS)'],
        weaknesses: ['A repeated error is only diagnosed after it repeats'],
        next: ['Draft rules for the top recurring errors on the Learning page'],
    });

    const checked = input.score.parts.find((p) => p.name === 'Checked');
    nodes.push({
        id: 'checks',
        title: 'Checks before "done"',
        subtitle: 'Tests, build, page and document checks',
        group: 3,
        row: 1,
        icon: 'check',
        health: checked?.value == null ? 'idle' : checked.value < 0.5 ? 'warn' : 'ok',
        metric: checked?.value == null ? 'no data yet' : `${Math.round(checked.value * 100)}% of code changes checked`,
        details: [{ label: 'Checked', value: checked?.detail ?? '—' }],
        issues: [],
        how: 'A code change cannot finish until the project’s own tests, type check or build pass after the last edit. Web pages load in a hidden browser (errors, cut-off and invisible content); decks, documents and PDFs are opened and checked for empty placeholders, overflow, tiny text and blank pages.',
        strengths: ['Catches what models claim but did not do'],
        weaknesses: ['Projects with no tests can only be checked by build or page load'],
        next: ['Screenshots compared with the design reference'],
    });

    const success = input.score.parts.find((p) => p.name === 'Success');
    const accuracy = input.score.parts.find((p) => p.name === 'Accuracy');
    nodes.push({
        id: 'outcome',
        title: 'Task outcome',
        subtitle: 'Finished, stopped, corrected',
        group: 4,
        row: 0,
        icon: 'outcome',
        health: !tasks ? 'idle' : rate(done, failed + stopped / 2),
        metric: input.score.score === null ? 'no score yet' : `Quality score ${input.score.score}`,
        details: [
            { label: 'Finished', value: success?.detail ?? `${n(done)} of ${n(done + failed)}` },
            { label: 'Corrected after', value: accuracy?.detail ?? '—' },
            { label: 'Tokens a task', value: input.score.tokensPerTask === null ? '—' : n(Math.round(input.score.tokensPerTask)) },
            { label: 'Requests a task', value: input.score.requestsPerTask === null ? '—' : input.score.requestsPerTask.toFixed(1) },
        ],
        issues: failed ? [`${n(failed)} tasks failed and ${n(stopped)} stopped in 14 days`] : [],
        how: 'Each finished task reports how it ended, how many steps and tokens it took, and whether the next message corrected it. The quality score weighs success, accuracy, checking and efficiency.',
        strengths: ['One number to watch release by release'],
        weaknesses: ['Only from installs that share counts'],
        next: ['Per-specialist scores on this page'],
    });

    const rated = input.feedback.good + input.feedback.bad;
    nodes.push({
        id: 'learning',
        title: 'Learning',
        subtitle: 'Lessons, ratings, error rules',
        group: 4,
        row: 1,
        icon: 'learn',
        health: !input.learningAvailable ? 'down' : input.lessons.pending > 20 ? 'warn' : rated || input.lessons.approved ? 'ok' : 'idle',
        metric: `${n(input.lessons.pending)} lessons waiting · ${rated ? `${pct(input.feedback.good, rated)} 👍` : 'no ratings'}`,
        details: [
            { label: 'Lessons waiting / shipped', value: `${n(input.lessons.pending)} / ${n(input.lessons.approved)}` },
            { label: 'Ratings', value: rated ? `${n(input.feedback.good)} 👍 · ${n(input.feedback.bad)} 👎` : '—' },
            { label: 'Top 👎 reason', value: Object.entries(input.feedback.reasons).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—' },
        ],
        issues: input.learningAvailable ? (input.lessons.pending > 20 ? [`${input.lessons.pending} lessons wait for approval on the Learning page`] : []) : ['Learning tables unreachable: check Supabase'],
        how: 'Corrections become general lessons, recurring errors become rules, and ratings and outcomes rank the models. What the admin approves goes to every install in the next daily download; the model order updates itself.',
        strengths: ['Never code, files or prompts', 'Every user benefits from one user’s correction'],
        weaknesses: ['Needs approvals to ship lessons'],
        next: ['Fine-tune a model once enough graded examples exist'],
    });

    nodes.push({
        id: 'lab',
        title: 'Nightly benchmarks',
        subtitle: 'Test lab, graded automatically',
        group: 4,
        row: 2,
        icon: 'lab',
        health: !input.lab.runs ? 'idle' : (input.lab.passRate ?? 1) < 0.6 ? 'warn' : 'ok',
        metric: input.lab.runs ? `${input.lab.passRate === undefined ? '—' : `${Math.round(input.lab.passRate * 100)}%`} of checks passed` : 'no runs yet',
        details: [
            { label: 'Runs, 14 days', value: n(input.lab.runs) },
            { label: 'Last run', value: input.lab.lastAt ? new Date(input.lab.lastAt).toISOString().slice(0, 16).replace('T', ' ') : '—' },
        ],
        issues: input.lab.failing.slice(0, 5).map((f) => `${f.title}: "${f.text}" failed ${f.failed} of ${f.graded}`),
        how: 'Benchmarks run every night on free models and are graded by real checks (slides, PDFs, tests, tokens). Checks that keep failing become rules to approve.',
        strengths: ['Catches regressions before users do'],
        weaknesses: ['Needs the LAB_TOKEN and model keys as GitHub secrets'],
        next: ['More benchmarks per domain'],
    });

    const edges: SystemEdge[] = [
        { from: 'editor', to: 'intent' },
        { from: 'intent', to: 'router' },
        ...PROVIDERS.map((p) => ({ from: 'router', to: p.id })),
        ...PROVIDERS.map((p) => ({ from: p.id, to: 'tools' })),
        { from: 'tools', to: 'checks' },
        { from: 'checks', to: 'outcome' },
        { from: 'outcome', to: 'learning' },
        { from: 'learning', to: 'router', loop: true },
        { from: 'lab', to: 'learning', loop: true },
    ];
    return { nodes, edges };
}

/** The overall state: the worst of the nodes that have data. */
export function overall(nodes: SystemNode[]): Health {
    const live = nodes.filter((x) => x.health !== 'idle');
    if (live.some((x) => x.health === 'down')) return 'down';
    if (live.some((x) => x.health === 'warn')) return 'warn';
    return live.length ? 'ok' : 'idle';
}
