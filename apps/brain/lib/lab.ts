import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { store } from './kv';
import { ACXIOM_SPEC } from './lab-specs/acxiom';

/**
 * The test lab: fixed tasks the admin runs through the extension to measure
 * how well the agent does real work. Each task has one or more prompts (later
 * ones are follow-ups) and optional starter files. The extension fetches the
 * tasks with a lab token, runs them in an empty folder, and sends back what
 * happened: the numbers, the files it changed and the conversation. The admin
 * then rates each run, and the page sums it up as a short report.
 */

export type LabCategory = 'app' | 'web' | 'ml' | 'followup' | 'other';

export interface LabTask {
    id: string;
    title: string;
    category: LabCategory;
    /** First prompt, then follow-ups, sent one after another. */
    prompts: string[];
    /** Starter files, path → text. */
    files: Record<string, string>;
    /** What a good result looks like, for the person rating it. */
    expect: string;
    /** Acceptance steps ticked when rating a run; the share passed is the run's score. */
    checklist?: string[];
    /** A reference result to beat, e.g. Claude's solution of the same task. */
    benchmark?: Benchmark;
}

export interface Benchmark {
    by: string;
    /** Checklist steps the reference passed. */
    passed: number;
    minutes?: number;
    note?: string;
    url?: string;
}

export interface LabTurn {
    prompt: string;
    reason: string;
    durationMs: number;
    tokens: number;
    steps: number;
    requests: number;
    models: string[];
    filesChanged: string[];
    usedFyx: boolean;
}

export interface LabResult {
    id: string;
    taskId: string;
    title: string;
    category: LabCategory;
    at: number;
    extension: string;
    turns: LabTurn[];
    /** The conversation as text: requests, replies, commands and notices. */
    transcript: string;
    /** Set by the admin after reading the run. */
    rating?: { understood: number; quality: number; notes: string; passed?: number[] };
}

export type LabSummary = Omit<LabResult, 'transcript'>;

const TASKS = 'pb:lab:tasks';
/** Built-in tasks already offered once, so one the admin deleted does not come back. */
const SEEDED = 'pb:lab:seeded';
const INDEX = 'pb:lab:results';
const TEN_YEARS = 10 * 365 * 24 * 60 * 60;
const MAX_RESULTS = 200;

/** The token the extension sends; derived from the admin password, so it changes with it. */
export function labToken(): string | undefined {
    const secret = (process.env.KEY_POOL_SECRET ?? process.env.ADMIN_PASSWORD)?.trim();
    return secret ? createHash('sha256').update(`lab:${secret}`).digest('hex').slice(0, 32) : undefined;
}

export function labAuthorised(request: Request): boolean {
    const token = labToken();
    return !!token && request.headers.get('x-lab-token') === token;
}

/** Real requests that went badly on 0.5.1, kept to measure every release against. */
const BENCHMARK_TASKS: LabTask[] = [
    {
        id: 'bench-nepal-deck',
        title: 'Benchmark: a 12-slide deck and PDF',
        category: 'other',
        prompts: [
            'i need a small ppt for prestning this so min 10 slides so keep 4 slides each 4 total 3*4 =12 slides total and gerate on this topic Nepal floods – 2026, keep images and also little and perfect content and flow chats and casues a perfetc and clear presentaion on this disater , a pdf',
        ],
        files: {},
        expect: 'One build script that makes a 12-slide .pptx and a PDF of it, with charts and a flowchart, run without errors from any folder.',
        checklist: [
            'Exactly 12 slides in the .pptx',
            'A PDF of the deck was produced',
            'At least 4 slides have an image or chart',
            'A flowchart of causes or response',
            'Clear flow: intro, causes, impact, response, way forward',
            'Short text that fits each slide',
            'Figures marked approximate, with a sources or notes slide',
            'The build script runs again without errors',
            'Finished without a token-limit pause',
        ],
        benchmark: {
            by: 'FreeAgentCoder 0.5.1',
            passed: 5,
            minutes: 30,
            note: 'Checked from its files: 12 slides, a 12-page PDF, charts on 10 slides, flow diagrams. Failed: content off the slide on 2 slides, no approximate figures or sources, 4 pauses (about 2.2M tokens). Re-running the script was not checked.',
        },
    },
    {
        id: 'bench-student-chatbot',
        title: 'Benchmark: AI student chatbot',
        category: 'app',
        prompts: [
            'Create a simple GenAI project called **AI Student Chatbot**.\n\nBuild a basic chatbot using an LLM API. The chatbot should:\n\n* Answer general student questions.\n* Explain academic topics in simple language.\n* Maintain basic conversation context.\n* Provide short, clear answers.\n* Have a simple web-based chat interface.\n\nUse **Python + Flask/FastAPI** for the backend and an **LLM API** for generating responses.\n\nKeep the project beginner-friendly and simple. Do not add unnecessary advanced features.',
        ],
        files: {},
        expect: 'A small FastAPI or Flask app with a chat page, a /chat endpoint that keeps a short history, the API key from .env, a README, and tests that pass.',
        checklist: [
            'Did not stop to ask about uv or poetry',
            'Backend in FastAPI or Flask with a /chat endpoint',
            'A web chat page that works in the browser',
            'Keeps conversation context between messages',
            'API key read from .env; .env.example provided',
            'README with setup and run steps',
            'Tests run and pass',
            'Server starts and answers a request',
            'No leftover temporary, debug or venv files in the project',
            'Finished without a token-limit pause',
        ],
        benchmark: {
            by: 'FreeAgentCoder 0.5.1',
            passed: 4,
            minutes: 25,
            note: 'Checked from its files: Flask /chat with history, key from the environment, README, 3 tests passing. Failed: asked about uv and poetry, no .env.example, eight leftover tmp/test/show scripts, 9 pauses (about 4.8M tokens). The page and server were not run.',
        },
    },
    {
        id: 'bench-acxiom-crm',
        title: 'Benchmark: AcxiomCRM from a requirements document',
        category: 'app',
        prompts: [
            'Build the AcxiomCRM project exactly as specified in AcxiomCRM_Requirements.md (ASP.NET Core MVC). Meet every mandatory requirement and walk the final acceptance scenario.',
        ],
        files: { 'AcxiomCRM_Requirements.md': ACXIOM_SPEC },
        expect: 'An ASP.NET Core MVC app with Identity, three roles, scoped data, validation on client and server, audit logging, a REST API, reports and a dashboard with Chart.js; dotnet build passes; REQUIREMENTS.md and EXPLAIN.md map each requirement to code.',
        checklist: [
            'Protected pages need login',
            'Register and login reach the Dashboard',
            'Invalid email or phone is blocked in the browser',
            'A crafted request with bad data is rejected by the server',
            'Opportunity amount of 0 or less is rejected',
            'Probability over 100 is rejected',
            'A past expected close date is rejected for an active opportunity',
            'A follow-up dated before today is rejected',
            'A Sales Executive sees only their own records',
            'A Manager has team pipeline and reports',
            'An Admin has users, roles and the audit log',
            'Create, update and delete write audit entries',
            '/api/customers returns authorised JSON',
            'Dashboard shows KPI cards and Chart.js charts',
        ],
        benchmark: {
            by: 'Claude (SmartSales)',
            passed: 14,
            note: 'As its EXPLAIN.md demo script claims; not run here. Requirement-to-code table in EXPLAIN.md, audit in SaveChangesAsync, one ForUser() scope filter, demo logins per role.',
            url: 'https://github.com/SkAshraf16/SmartSales',
        },
    },
];

export const DEFAULT_TASKS: LabTask[] = [
    {
        id: 'app-todo',
        title: 'App: a todo app from nothing',
        category: 'app',
        prompts: ['Build a todo app with React and Vite: add, complete, delete and filter tasks, saved in local storage. Make it run.'],
        files: {},
        expect: 'A working Vite + React project that installs and runs; all four features work; tasks survive a reload.',
    },
    {
        id: 'web-landing',
        title: 'Web: a landing page',
        category: 'web',
        prompts: ['Make a responsive landing page for a coffee shop called Brew Lab: hero, menu with prices, opening hours and a contact form. Plain HTML and CSS.'],
        files: {},
        expect: 'index.html and a stylesheet; every section present; looks right at phone width; no broken links or missing files.',
    },
    {
        id: 'ml-classifier',
        title: 'ML: train and evaluate a classifier',
        category: 'ml',
        prompts: [
            'Train a classifier on the data in data.csv to predict the "label" column. Hold out a test set, report accuracy against a simple baseline, and save the trained model.',
        ],
        files: {
            'data.csv':
                'hours_studied,hours_slept,attended,label\n1,8,0,fail\n2,7,0,fail\n3,6,1,fail\n4,7,1,pass\n5,8,1,pass\n6,6,1,pass\n7,7,1,pass\n8,5,1,pass\n2,4,0,fail\n3,5,0,fail\n4,6,0,fail\n5,7,1,pass\n6,8,1,pass\n1,5,0,fail\n7,6,1,pass\n8,8,1,pass\n2,6,1,fail\n3,7,1,pass\n4,5,0,fail\n6,7,0,pass\n',
        },
        expect: 'A Python script with a fixed seed and a held-out split; accuracy reported next to a majority-class baseline; the model saved to a file; it actually ran.',
    },
    {
        id: 'followup-counter',
        title: 'Follow-up: change work in steps',
        category: 'followup',
        prompts: [
            'Create a small web page with a counter: a number and a button that adds one.',
            'Add a reset button.',
            'Now make it remember the count after a page reload.',
            'The buttons are too small on a phone. Fix that.',
        ],
        files: {},
        expect: 'Each follow-up changes only what was asked and keeps earlier work; the final page has both buttons, persists the count and has larger tap targets.',
    },
    {
        id: 'fix-bug',
        title: 'Fix: find and fix a bug',
        category: 'other',
        prompts: ['The total in cart.js is wrong when an item has a quantity of more than one. Find the bug, fix it, and prove the fix with a test.'],
        files: {
            'cart.js':
                "export function total(items) {\n  let sum = 0;\n  for (const item of items) {\n    sum += item.price;\n  }\n  return Math.round(sum * 100) / 100;\n}\n",
            'package.json': '{\n  "name": "cart",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n',
        },
        expect: 'The loop multiplies by quantity; a test covering quantity > 1 is added and passes; nothing else changed.',
    },
    ...BENCHMARK_TASKS,
];

export async function readTasks(): Promise<LabTask[]> {
    const [raw, seededRaw] = await store.getMany([TASKS, SEEDED]);
    let tasks: LabTask[];
    try {
        tasks = raw ? (JSON.parse(raw) as LabTask[]) : DEFAULT_TASKS;
    } catch {
        tasks = DEFAULT_TASKS;
    }
    // A built-in task added after the list was saved is offered once.
    const seeded = new Set<string>(seededRaw ? (JSON.parse(seededRaw) as string[]) : []);
    const missing = DEFAULT_TASKS.filter((t) => !seeded.has(t.id) && !tasks.some((own) => own.id === t.id));
    if (missing.length || DEFAULT_TASKS.some((t) => !seeded.has(t.id))) {
        tasks = [...tasks, ...missing];
        await Promise.all([
            raw || missing.length ? writeTasks(tasks) : Promise.resolve(),
            store.put(SEEDED, JSON.stringify(DEFAULT_TASKS.map((t) => t.id)), TEN_YEARS),
        ]);
    }
    return tasks;
}

export async function writeTasks(tasks: LabTask[]): Promise<void> {
    await store.put(TASKS, JSON.stringify(tasks), TEN_YEARS);
}

export async function listResults(): Promise<LabSummary[]> {
    const [raw] = await store.getMany([INDEX]);
    try {
        return raw ? (JSON.parse(raw) as LabSummary[]) : [];
    } catch {
        return [];
    }
}

export async function readResult(id: string): Promise<LabResult | undefined> {
    const [raw] = await store.getMany([`pb:lab:result:${id}`]);
    return raw ? (JSON.parse(raw) as LabResult) : undefined;
}

export async function saveResult(input: Omit<LabResult, 'id' | 'at' | 'rating'>): Promise<string> {
    const result: LabResult = { ...input, id: randomUUID(), at: Date.now(), transcript: input.transcript.slice(0, 120_000) };
    await store.put(`pb:lab:result:${result.id}`, JSON.stringify(result), TEN_YEARS);
    const { transcript: _drop, ...summary } = result;
    const index = [summary, ...(await listResults())].slice(0, MAX_RESULTS);
    await store.put(INDEX, JSON.stringify(index), TEN_YEARS);
    return result.id;
}

export async function rateResult(id: string, rating: LabResult['rating']): Promise<void> {
    const result = await readResult(id);
    if (!result) return;
    result.rating = rating;
    await store.put(`pb:lab:result:${id}`, JSON.stringify(result), TEN_YEARS);
    const index = (await listResults()).map((r) => (r.id === id ? { ...r, rating } : r));
    await store.put(INDEX, JSON.stringify(index), TEN_YEARS);
}

export async function deleteResult(id: string): Promise<void> {
    await store.put(`pb:lab:result:${id}`, '', 1);
    await store.put(INDEX, JSON.stringify((await listResults()).filter((r) => r.id !== id)), TEN_YEARS);
}

export interface LabReportRow {
    category: string;
    runs: number;
    completed: number;
    avgSeconds: number;
    avgTokens: number;
    avgRequests: number;
    understood: number | null;
    quality: number | null;
}

/** The mini report: per kind of task, how runs went and how they were rated. */
export function report(results: LabSummary[]): LabReportRow[] {
    const groups = new Map<string, LabSummary[]>();
    for (const r of results) groups.set(r.category, [...(groups.get(r.category) ?? []), r]);
    return [...groups.entries()].map(([category, runs]) => {
        const turns = runs.flatMap((r) => r.turns);
        const avg = (n: number) => (turns.length ? Math.round(n / turns.length) : 0);
        const rated = runs.filter((r) => r.rating);
        const mean = (pick: (r: LabSummary) => number) => (rated.length ? Math.round((rated.reduce((s, r) => s + pick(r), 0) / rated.length) * 10) / 10 : null);
        return {
            category,
            runs: runs.length,
            completed: runs.filter((r) => r.turns.length && r.turns.every((t) => t.reason === 'completed')).length,
            avgSeconds: Math.round(avg(turns.reduce((s, t) => s + t.durationMs, 0)) / 1000),
            avgTokens: avg(turns.reduce((s, t) => s + t.tokens, 0)),
            avgRequests: avg(turns.reduce((s, t) => s + t.requests, 0)),
            understood: mean((r) => r.rating!.understood),
            quality: mean((r) => r.rating!.quality),
        };
    });
}

export interface ScoreRow {
    taskId: string;
    title: string;
    steps: number;
    benchmark?: Benchmark;
    runs: number;
    /** Share of checklist steps passed, 0-100, for the latest and the best rated run. */
    latest: number | null;
    best: number | null;
    latestMinutes: number | null;
    latestTokens: number | null;
    latestPauses: number | null;
    latestExtension?: string;
}

/** Each task with a checklist: how its rated runs score, next to the benchmark. */
export function scorecard(tasks: LabTask[], results: LabSummary[]): ScoreRow[] {
    return tasks
        .filter((t) => t.checklist?.length)
        .map((task) => {
            const steps = task.checklist!.length;
            const runs = results.filter((r) => r.taskId === task.id).sort((a, b) => b.at - a.at);
            const scored = runs.filter((r) => r.rating?.passed);
            const pct = (r: LabSummary) => Math.round(((r.rating!.passed!.length) / steps) * 100);
            const latest = runs[0];
            return {
                taskId: task.id,
                title: task.title,
                steps,
                benchmark: task.benchmark,
                runs: runs.length,
                latest: scored[0] ? pct(scored[0]) : null,
                best: scored.length ? Math.max(...scored.map(pct)) : null,
                latestMinutes: latest ? Math.round(latest.turns.reduce((s, t) => s + t.durationMs, 0) / 60_000) : null,
                latestTokens: latest ? latest.turns.reduce((s, t) => s + t.tokens, 0) : null,
                latestPauses: latest ? latest.turns.filter((t) => t.reason === 'budget').length : null,
                latestExtension: latest?.extension,
            };
        });
}
