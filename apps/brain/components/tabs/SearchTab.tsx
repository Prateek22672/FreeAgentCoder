'use client';

import { useEffect, useState } from 'react';
import type { SearchHitView } from '@/lib/types';
import { callBrain, type TabProps } from '@/lib/client';
import { Button, Empty, FileLink, RoleBadge, Spinner, TextInput } from '../ui';

export function SearchTab({ data, open, reanalyze, prefill, prefillKey }: TabProps) {
    const [q, setQ] = useState(prefill ?? '');
    const [hits, setHits] = useState<SearchHitView[]>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string>();

    const run = async (query = q) => {
        if (!query.trim()) return;
        setBusy(true);
        setError(undefined);
        try {
            const result = await callBrain<{ hits: SearchHitView[] }>('/api/search', { q: query }, data.id, reanalyze);
            setHits(result.hits);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => {
        if (prefill) void run(prefill);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prefillKey]);

    return (
        <div className="mx-auto max-w-4xl">
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    void run();
                }}
                className="flex gap-2"
            >
                <TextInput autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="authentication middleware, UserService, database connection…" />
                <Button type="submit" disabled={busy || !q.trim()}>
                    {busy ? <Spinner /> : 'Search'}
                </Button>
            </form>
            <p className="mt-2 text-xs text-faint">Ranked search over {data.indexedFiles.toLocaleString()} files, by the words in your query and the identifiers in the code. Runs locally — no AI key needed.</p>

            {error && <p className="mt-4 text-sm text-bad">{error}</p>}
            {hits && hits.length === 0 && <Empty>Nothing in this repository matches those words.</Empty>}
            <ul className="mt-5 space-y-3">
                {hits?.map((hit) => (
                    <li key={`${hit.path}:${hit.start}`} className="overflow-hidden rounded-lg border border-line bg-panel">
                        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                            <FileLink path={hit.path} lines={{ start: hit.start, end: hit.end }} onOpen={open} />
                            <RoleBadge role={hit.role} />
                            <span className="ml-auto truncate font-mono text-[11px] text-faint">{hit.matched.join(' · ')}</span>
                        </div>
                        <button type="button" onClick={() => open(hit.path, { start: hit.start, end: hit.end })} className="block w-full text-left">
                            <pre className="scroll-thin overflow-x-auto bg-code px-3 py-2 font-mono text-[12px] leading-relaxed text-muted">
                                {hit.snippet.split('\n').map((line, i) => (
                                    <div key={i}>
                                        <span className="inline-block w-10 select-none pr-3 text-right text-faint">{hit.snippetStart + i}</span>
                                        {line || ' '}
                                    </div>
                                ))}
                            </pre>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}
