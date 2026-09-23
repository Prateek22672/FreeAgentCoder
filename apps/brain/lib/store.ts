/**
 * Ingested repositories, held in memory for this phase.
 *
 * Deliberately not persisted: repository content is sensitive, and Phase 1 has
 * no accounts to tie it to. Entries expire after an hour and the store holds a
 * handful at most. Concurrent requests for the same repository share one
 * ingestion.
 */
import 'server-only';
import { CodeIndex, MemoryWorkspace } from '@agentic/core';
import {
    analyzeRepository,
    buildImportGraph,
    buildRepoInput,
    findPossibleSecrets,
    toFileMap,
    type Analysis,
    type ImportGraph,
    type RepoInput,
} from '@agentic/project-brain';
import { fetchEntries, fetchMeta, parseRepo, type Progress } from './github';

export interface Brain {
    id: string;
    input: RepoInput;
    analysis: Analysis;
    index: CodeIndex;
    graph: ImportGraph;
    /** Paths whose text was read; the only paths answers may cite. */
    known: Set<string>;
    byPath: Map<string, RepoInput['files'][number]>;
    /** Where secrets seem to be committed. Paths only; values are never kept. */
    secrets: { path: string; kind: string }[];
    timings: { download: number; analyze: number; index: number };
    createdAt: number;
}

const TTL_MS = 60 * 60 * 1000;
const MAX_BRAINS = 6;

// Survives Next.js hot reloads in development.
const globalStore = globalThis as unknown as { __brains?: Map<string, Brain>; __pending?: Map<string, Promise<Brain>> };
const brains = (globalStore.__brains ??= new Map());
const pending = (globalStore.__pending ??= new Map());

function evict(): void {
    const now = Date.now();
    for (const [id, brain] of brains) if (now - brain.createdAt > TTL_MS) brains.delete(id);
    while (brains.size > MAX_BRAINS) {
        const oldest = [...brains.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
        if (!oldest) break;
        brains.delete(oldest.id);
    }
}

export function brainId(owner: string, repo: string, ref: string): string {
    return `${owner}/${repo}@${ref}`.toLowerCase();
}

export function getBrain(id: string): Brain | undefined {
    evict();
    return brains.get(id.toLowerCase());
}

async function build(owner: string, repo: string, ref: string | undefined, progress?: Progress): Promise<Brain> {
    const t0 = Date.now();
    const meta = await fetchMeta(owner, repo, ref);
    const entries = await fetchEntries(owner, repo, meta.ref, progress);
    const t1 = Date.now();
    progress?.({ step: 'analyze', message: 'Detecting the stack, layers and imports' });

    const input = buildRepoInput(entries);
    const analysis = analyzeRepository(input, {
        owner: meta.owner,
        repo: meta.repo,
        ref: meta.ref,
        description: meta.description,
        stars: meta.stars,
        private: meta.private,
        url: meta.url,
    });
    const graph = buildImportGraph(input.files);
    const t2 = Date.now();
    progress?.({ step: 'index', message: `Building the search index over ${input.files.length.toLocaleString()} files` });

    // Core's BM25 index, unchanged — the same search the VS Code agent uses.
    const index = new CodeIndex(new MemoryWorkspace(toFileMap(input.files)), { maxFiles: 10_000, maxFileBytes: 512 * 1024 });
    await index.refresh();
    const t3 = Date.now();

    return {
        id: brainId(meta.owner, meta.repo, meta.ref),
        input,
        analysis,
        index,
        graph,
        known: new Set(input.files.map((f) => f.path)),
        byPath: new Map(input.files.map((f) => [f.path, f])),
        secrets: findPossibleSecrets(input.files),
        timings: { download: t1 - t0, analyze: t2 - t1, index: t3 - t2 },
        createdAt: Date.now(),
    };
}

export async function loadBrain(spec: string, progress?: Progress): Promise<Brain> {
    evict();
    const { owner, repo, ref } = parseRepo(spec);
    const key = `${owner}/${repo}@${ref ?? ''}`.toLowerCase();
    const cached = [...brains.values()].find((b) => b.id === brainId(owner, repo, ref ?? b.analysis.meta.ref) && (!ref || b.analysis.meta.ref === ref));
    if (cached) return cached;

    let job = pending.get(key);
    if (!job) {
        job = build(owner, repo, ref, progress).finally(() => pending.delete(key));
        pending.set(key, job);
    }
    const brain = await job;
    brains.set(brain.id, brain);
    return brain;
}
