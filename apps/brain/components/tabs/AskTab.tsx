'use client';

import type { GroundedAnswer } from '@agentic/project-brain';
import { useEffect, useRef, useState } from 'react';
import { useOwnKey } from '@/lib/keys';
import type { AskEvent } from '@/lib/types';
import type { TabProps } from '@/lib/client';
import { KeyPanel } from '../KeyPanel';
import { Markdown } from '../Markdown';
import { Button, FileLink, Spinner, TextInput } from '../ui';

interface Turn {
    question: string;
    answer: string;
    model?: string;
    evidence?: string[];
    grounding?: GroundedAnswer;
    error?: string;
    done: boolean;
}

export function AskTab({ data, known, open, reanalyze, prefill, prefillKey }: TabProps) {
    const [q, setQ] = useState('');
    const [turns, setTurns] = useState<Turn[]>([]);
    const [busy, setBusy] = useState(false);
    const abort = useRef<AbortController | undefined>(undefined);
    const { own } = useOwnKey();
    // undefined until loaded; null when the site has no free trial.
    const [trial, setTrial] = useState<{ limit: number; remaining: number; closed?: boolean } | null>();
    const [showKeys, setShowKeys] = useState(false);
    const [keyReason, setKeyReason] = useState<string>();

    useEffect(() => {
        fetch('/api/ai')
            .then((r) => r.json())
            .then((body: { trial: { limit: number; remaining: number; closed?: boolean } | null }) => setTrial(body.trial))
            .catch(() => setTrial(null));
    }, []);

    // The server decides in the end; before the trial status arrives, let the question through.
    const mustAddKey = !own && trial !== undefined && (trial === null || trial.remaining <= 0);
    const canAsk = !!own || !mustAddKey;

    const update = (fn: (turn: Turn) => Turn) => setTurns((all) => [...all.slice(0, -1), fn(all[all.length - 1]!)]);

    const ask = async (question: string) => {
        if (!question.trim() || busy) return;
        setQ('');
        setBusy(true);
        setTurns((all) => [...all, { question, answer: '', done: false }]);
        const controller = new AbortController();
        abort.current = controller;

        const post = (id: string) =>
            fetch('/api/ask', {
                method: 'POST',
                // Your own key, if you saved one: used for this request only, never stored by the server.
                headers: { 'Content-Type': 'application/json', ...(own ? { 'X-Brain-Provider': own.provider, 'X-Brain-Key': own.key } : {}) },
                body: JSON.stringify({ id, question }),
                signal: controller.signal,
            });
        try {
            let response = await post(data.id);
            if (response.status === 410) response = await post(await reanalyze());
            if (!response.ok || !response.body) {
                const body = (await response.json().catch(() => ({}))) as { error?: string; needKey?: boolean; badKey?: boolean };
                update((t) => ({ ...t, error: body.error ?? 'The request failed.', done: true }));
                if (body.needKey || body.badKey) {
                    setKeyReason(body.error);
                    setShowKeys(true);
                    if (body.needKey && !own) setTrial((current) => (current ? { ...current, remaining: 0 } : current));
                }
                return;
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
                    const event = JSON.parse(line) as AskEvent;
                    if (event.type === 'text') update((t) => ({ ...t, answer: t.answer + event.delta }));
                    else if (event.type === 'reset') update((t) => ({ ...t, answer: '' }));
                    else if (event.type === 'model') update((t) => ({ ...t, model: event.ref }));
                    else if (event.type === 'evidence') {
                        update((t) => ({ ...t, evidence: event.files }));
                        const access = event.access;
                        if (access?.mode === 'trial') setTrial({ limit: access.limit, remaining: access.remaining });
                    }
                    else if (event.type === 'done') update((t) => ({ ...t, grounding: event.grounding, model: event.model || t.model, done: true }));
                    else if (event.type === 'error') update((t) => ({ ...t, error: event.message, done: true }));
                }
            }
            update((t) => ({ ...t, done: true }));
        } catch (e) {
            update((t) => ({ ...t, error: controller.signal.aborted ? 'Stopped.' : (e as Error).message, done: true }));
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => {
        if (prefill) void ask(prefill);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prefillKey]);

    return (
        <div className="mx-auto max-w-3xl">
            {own ? (
                <div className="mb-4">
                    <KeyPanel />
                </div>
            ) : trial && trial.remaining > 0 && !showKeys ? (
                <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-line bg-panel px-4 py-2.5 text-[13px] text-muted">
                    <span className="font-medium text-fg">Free trial</span>· {trial.remaining} of {trial.limit} questions left today ·
                    <button type="button" onClick={() => setShowKeys(true)} className="text-accent underline underline-offset-4">
                        Use your own free key to keep going
                    </button>
                </p>
            ) : null}
            {!own && (mustAddKey || showKeys) && (
                <div className="mb-6">
                    <KeyPanel
                        reason={keyReason ?? (trial === null ? 'This site has no free trial right now, so questions use your own key.' : trial && trial.remaining <= 0 ? (trial.closed ? "Today's free questions on this site are used up." : "You've used today's free questions.") : undefined)}
                        onSaved={() => {
                            setShowKeys(false);
                            setKeyReason(undefined);
                        }}
                    />
                </div>
            )}

            <div className="space-y-6">
                {turns.map((turn, i) => (
                    <article key={i} className="rounded-lg border border-line bg-panel">
                        <header className="border-b border-line px-4 py-3 text-[14px] font-medium text-fg">{turn.question}</header>
                        <div className="px-4 py-3">
                            {!turn.answer && !turn.error && (
                                <div className="flex items-center gap-2 text-sm text-muted">
                                    <Spinner /> Reading {turn.evidence ? `${turn.evidence.length} relevant files` : 'the repository'}…
                                </div>
                            )}
                            {turn.answer && <Markdown text={turn.answer} known={known} onOpen={open} />}
                            {turn.error && <p className="whitespace-pre-wrap text-sm text-bad">{turn.error}</p>}
                        </div>
                        {turn.done && turn.grounding && <Grounding grounding={turn.grounding} open={open} />}
                        {turn.model && <footer className="border-t border-line px-4 py-2 font-mono text-[11px] text-faint">{turn.model}</footer>}
                    </article>
                ))}
            </div>

            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    void ask(q);
                }}
                className="sticky bottom-4 mt-6 flex gap-2 rounded-lg border border-line-strong bg-panel p-2 shadow-lg"
            >
                <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Where is authentication handled? Which files depend on UserService?" className="border-0 bg-transparent focus:border-0" disabled={!canAsk} />
                {busy ? (
                    <Button type="button" variant="outline" onClick={() => abort.current?.abort()}>
                        Stop
                    </Button>
                ) : (
                    <Button type="submit" disabled={!q.trim() || !canAsk}>
                        Ask
                    </Button>
                )}
            </form>
        </div>
    );
}

/** What the answer actually rests on, and anything it made up. */
function Grounding({ grounding, open }: { grounding: GroundedAnswer; open: TabProps['open'] }) {
    const valid = grounding.citations.filter((c) => c.valid);
    return (
        <div className="border-t border-line px-4 py-3">
            {grounding.unsupported ? (
                <p className="text-[13px] text-warn">This answer doesn&apos;t cite any file from the repository, so treat it as unverified.</p>
            ) : (
                <>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Verified references · {valid.length}</p>
                    <ul className="flex flex-wrap gap-x-4 gap-y-1">
                        {valid.map((c) => (
                            <li key={`${c.path}:${c.lines?.start ?? ''}`} className="flex min-w-0 max-w-full items-center gap-1.5">
                                <span className="text-ok">✓</span>
                                <FileLink path={c.path} lines={c.lines} onOpen={open} />
                            </li>
                        ))}
                    </ul>
                </>
            )}
            {grounding.invented.length > 0 && (
                <p className="mt-2 text-[13px] text-bad">
                    Not in this repository, ignore: <span className="font-mono wrap-anywhere">{grounding.invented.join(', ')}</span>
                </p>
            )}
        </div>
    );
}
