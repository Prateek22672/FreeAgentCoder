'use client';

import type { AnalyzeResponse } from './types';

export type ViewId = 'overview' | 'architecture' | 'ask' | 'search' | 'impact' | 'dependencies' | 'files';

/** What every view in the workbench receives. */
export interface TabProps {
    data: AnalyzeResponse;
    known: Set<string>;
    open: (path: string, lines?: { start: number; end: number }) => void;
    /** Re-run ingestion after the server's copy expired; resolves to the new id. */
    reanalyze: () => Promise<string>;
    goTo: (view: ViewId, prefill?: string, file?: string) => void;
    prefill?: string;
    prefillFile?: string;
    /** Changes every time a prefill is sent, so the same text can be run twice. */
    prefillKey?: number;
}

/** POST that transparently re-analyzes once if the server dropped this repository. */
export async function callBrain<T>(path: string, body: Record<string, unknown>, id: string, reanalyze: () => Promise<string>): Promise<T> {
    const run = async (brainId: string) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, id: brainId }) });
    let response = await run(id);
    if (response.status === 410) response = await run(await reanalyze());
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status}).`);
    return data;
}

export type AnalyzeProgress = { step: 'list' | 'download' | 'analyze' | 'index'; message: string; done?: number; total?: number };

/** Analyze with live progress: streams NDJSON and resolves with the result. */
export async function analyzeWithProgress(repo: string, onProgress: (event: AnalyzeProgress) => void, signal?: AbortSignal): Promise<AnalyzeResponse> {
    const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        body: JSON.stringify({ repo }),
        signal,
    });
    if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Analysis failed (${response.status}).`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as { type: 'progress' } & AnalyzeProgress | { type: 'done'; result: AnalyzeResponse } | { type: 'error'; message: string };
            if (event.type === 'progress') onProgress(event);
            else if (event.type === 'done') return event.result;
            else if (event.type === 'error') throw new Error(event.message);
        }
    }
    throw new Error('The analysis stopped before it finished. Try again.');
}
