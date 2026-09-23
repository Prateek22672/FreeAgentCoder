'use client';

import { useEffect, useState } from 'react';
import type { AnalyzeProgress } from '@/lib/client';
import { Icon } from '../icons';
import { Spinner, cx } from '../ui';

type StepId = 'repo' | 'list' | 'download' | 'analyze' | 'index';

export interface StepState {
    id: StepId;
    label: string;
    detail?: string;
    state: 'todo' | 'active' | 'done';
    startedAt?: number;
    endedAt?: number;
    done?: number;
    total?: number;
}

/** A fresh checklist, timed from now. */
export function initialSteps(): StepState[] {
    return [
        { id: 'repo', label: 'Find the repository on GitHub', state: 'active', startedAt: Date.now() },
        { id: 'list', label: 'List every file and decide what to read', state: 'todo' },
        { id: 'download', label: 'Download the source — never binaries or dependencies', state: 'todo' },
        { id: 'analyze', label: 'Detect the stack, layers and imports', state: 'todo' },
        { id: 'index', label: 'Build the code search index', state: 'todo' },
    ];
}

/** Fold one progress event into the checklist. Earlier steps complete as later ones start. */
export function advance(steps: StepState[], event: AnalyzeProgress): StepState[] {
    const now = Date.now();
    const target: StepId =
        event.step === 'list' ? (/Contacting/.test(event.message) ? 'repo' : 'list') : event.step === 'download' ? 'download' : event.step;
    const order = steps.findIndex((s) => s.id === target);
    const summary = event.step === 'list' && event.message.includes('·');
    return steps.map((step, i) => {
        if (i < order) return step.state === 'done' ? step : { ...step, state: 'done', endedAt: now, detail: step.detail ?? (step.id === 'repo' ? 'Public repository found' : step.detail) };
        if (i > order) return step;
        return {
            ...step,
            state: summary ? 'done' : 'active',
            startedAt: step.startedAt ?? now,
            ...(summary ? { endedAt: now } : {}),
            detail: target === 'download' && event.total ? `${event.done} of ${event.total} files` : event.message.startsWith('Listing') || event.message.startsWith('Contacting') ? step.detail : event.message,
            done: event.done ?? step.done,
            total: event.total ?? step.total,
        };
    });
}

export function Progress({ repo, steps, error, onRetry }: { repo: string; steps: StepState[]; error?: string; onRetry: () => void }) {
    const [, tick] = useState(0);
    useEffect(() => {
        const t = setInterval(() => tick((n) => n + 1), 100);
        return () => clearInterval(t);
    }, []);
    const started = steps[0]?.startedAt ?? Date.now();
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);

    return (
        <div className="mx-auto w-full max-w-xl px-6 py-14">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">Building the Project Brain</p>
            <h2 className="mt-2 font-mono text-xl text-fg">{repo}</h2>
            <ol className="mt-8 space-y-4">
                {steps.map((step) => {
                    const ms = step.startedAt && step.endedAt ? step.endedAt - step.startedAt : undefined;
                    return (
                        <li key={step.id} className="flex gap-3">
                            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
                                {step.state === 'done' ? (
                                    <span className="flex size-5 items-center justify-center rounded-full bg-ok/15 text-ok">
                                        <Icon name="check" size={13} />
                                    </span>
                                ) : step.state === 'active' && !error ? (
                                    <Spinner />
                                ) : (
                                    <span className="size-2 rounded-full bg-line-strong" />
                                )}
                            </span>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-baseline justify-between gap-3">
                                    <span className={cx('text-[14px]', step.state === 'todo' ? 'text-faint' : 'text-fg')}>{step.label}</span>
                                    {ms !== undefined && <span className="font-mono text-[11px] tabular-nums text-faint">{ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`}</span>}
                                </div>
                                {step.detail && <p className="mt-0.5 text-[12.5px] text-muted wrap-anywhere">{step.detail}</p>}
                                {step.id === 'download' && step.state === 'active' && step.total ? (
                                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-panel-2">
                                        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(((step.done ?? 0) / step.total) * 100)}%` }} />
                                    </div>
                                ) : null}
                            </div>
                        </li>
                    );
                })}
            </ol>
            {error ? (
                <div className="mt-8 rounded-lg border border-bad/40 bg-bad/10 px-4 py-3">
                    <p className="text-sm text-fg">{error}</p>
                    <div className="mt-3 flex gap-3 text-sm">
                        <button type="button" onClick={onRetry} className="text-accent underline underline-offset-4">
                            Try again
                        </button>
                        <a href="/" className="text-muted underline underline-offset-4 hover:text-fg">
                            Analyze another repository
                        </a>
                    </div>
                </div>
            ) : (
                <p className="mt-8 flex items-center gap-2 font-mono text-[12px] tabular-nums text-faint">
                    <Icon name="shield" size={13} /> {elapsed}s · read-only · nothing from the repository is executed
                </p>
            )}
        </div>
    );
}
