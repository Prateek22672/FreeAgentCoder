import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { store } from './kv';

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
    rating?: { understood: number; quality: number; notes: string };
}

export type LabSummary = Omit<LabResult, 'transcript'>;

const TASKS = 'pb:lab:tasks';
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
];

export async function readTasks(): Promise<LabTask[]> {
    const [raw] = await store.getMany([TASKS]);
    if (!raw) return DEFAULT_TASKS;
    try {
        return JSON.parse(raw) as LabTask[];
    } catch {
        return DEFAULT_TASKS;
    }
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
