'use client';

import { useEffect, useState } from 'react';
import { callBrain, type TabProps } from '@/lib/client';
import type { SearchHitView } from '@/lib/types';
import { Spinner } from '../ui';

/** The sidebar search, like VS Code's: compact results, click to open at the line. */
export function SearchPanel({ data, open, reanalyze, query, queryKey }: Pick<TabProps, 'data' | 'open' | 'reanalyze'> & { query?: string; queryKey?: number }) {
    const [q, setQ] = useState(query ?? '');
    const [hits, setHits] = useState<SearchHitView[]>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string>();

    const run = async (text: string) => {
        if (!text.trim()) return;
        setBusy(true);
        setError(undefined);
        try {
            setHits((await callBrain<{ hits: SearchHitView[] }>('/api/search', { q: text }, data.id, reanalyze)).hits);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => {
        if (query) {
            setQ(query);
            void run(query);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queryKey]);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <form
                className="px-3 pb-2"
                onSubmit={(e) => {
                    e.preventDefault();
                    void run(q);
                }}
            >
                <input
                    autoFocus
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search code — Enter"
                    aria-label="Search code"
                    className="h-7 w-full rounded border border-line bg-bg px-2 text-[12px] text-fg placeholder:text-faint focus:border-accent focus:outline-none"
                />
            </form>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-3">
                {busy && (
                    <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-muted">
                        <Spinner className="size-3" /> Searching {data.indexedFiles.toLocaleString()} files…
                    </div>
                )}
                {error && <p className="px-3 py-2 text-[12px] text-bad">{error}</p>}
                {hits && !busy && <p className="px-3 pb-1 text-[11px] text-faint">{hits.length ? `${hits.length} results, implementation first` : 'No matches'}</p>}
                <ul>
                    {hits?.map((hit) => {
                        const name = hit.path.slice(hit.path.lastIndexOf('/') + 1);
                        const dir = hit.path.slice(0, hit.path.lastIndexOf('/'));
                        const terms = hit.matched.map((m) => m.toLowerCase());
                        const lines = hit.snippet.split('\n');
                        const lineIndex = Math.max(0, lines.findIndex((l) => terms.some((t) => l.toLowerCase().includes(t))));
                        return (
                            <li key={`${hit.path}:${hit.start}`}>
                                <button
                                    type="button"
                                    onClick={() => open(hit.path, { start: hit.snippetStart + lineIndex, end: hit.snippetStart + lineIndex })}
                                    className="block w-full px-3 py-1.5 text-left hover:bg-panel-2"
                                >
                                    <span className="flex items-baseline gap-1.5 text-[12.5px]">
                                        <span className="truncate text-fg">{name}</span>
                                        <span className="truncate text-[11px] text-faint">{dir}</span>
                                    </span>
                                    <span className="mt-0.5 block truncate font-mono text-[11.5px] text-muted">
                                        <span className="text-faint">{hit.snippetStart + lineIndex} </span>
                                        {(lines[lineIndex] ?? '').trim()}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
}
