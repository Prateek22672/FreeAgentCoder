/**
 * The landing page's product shot: the real workbench layout, filled with a
 * real analysis (lib/sample.ts), so a visitor sees actual output before
 * pasting anything. Every part of it links into the live app.
 */
import { buildPlan, roleOf } from '@agentic/project-brain';
import Link from 'next/link';
import { SAMPLE, SAMPLE_IMPACT } from '@/lib/sample';
import { Icon, type IconName } from '../icons';

const ACTIVITY: IconName[] = ['overview', 'files', 'search', 'ask', 'impact', 'layers', 'package'];
const DOT = new Set(['api', 'component', 'model', 'service', 'test']);

export function ProductPreview() {
    const plan = buildPlan(SAMPLE_IMPACT).slice(0, 5);
    const live = `/r/${SAMPLE.meta.owner}/${SAMPLE.meta.repo}?tab=impact&q=${encodeURIComponent(SAMPLE_IMPACT.query)}`;
    const folders = new Map<string, string[]>();
    for (const path of SAMPLE.explorer) {
        const dir = path.split('/').slice(0, -1).join('/');
        folders.set(dir, [...(folders.get(dir) ?? []), path]);
    }

    return (
        <figure className="relative">
            <div className="overflow-hidden rounded-xl border border-line-strong bg-bg shadow-[0_30px_120px_-20px_rgba(0,0,0,0.6)]">
                {/* Title bar */}
                <div className="flex h-9 items-center gap-3 border-b border-line bg-panel px-3">
                    <span className="flex gap-1.5" aria-hidden>
                        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
                        <span className="size-2.5 rounded-full bg-[#febc2e]" />
                        <span className="size-2.5 rounded-full bg-[#28c840]" />
                    </span>
                    <span className="font-mono text-[11.5px] text-muted">
                        <span className="text-accent">▣</span> Project Brain / {SAMPLE.meta.owner} / <span className="text-fg">{SAMPLE.meta.repo}</span>
                    </span>
                    <span className="mx-auto hidden h-6 w-72 items-center rounded border border-line bg-bg px-2 text-[11px] text-faint md:flex">Ask anything about this codebase…</span>
                    <span className="hidden rounded bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-fg sm:block">Plan a change</span>
                </div>

                <div className="flex h-[26rem]">
                    <div className="hidden w-11 flex-col items-center gap-3 border-r border-line bg-panel py-3 sm:flex" aria-hidden>
                        {ACTIVITY.map((name) => (
                            <Icon key={name} name={name} size={17} className={name === 'impact' ? 'text-fg' : 'text-faint'} />
                        ))}
                    </div>

                    {/* Explorer */}
                    <div className="hidden w-56 shrink-0 overflow-hidden border-r border-line bg-panel md:block">
                        <p className="px-3 pb-1.5 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-faint">Explorer</p>
                        {[...folders].map(([dir, files]) => (
                            <div key={dir}>
                                <p className="flex items-center gap-1 px-2 py-[2px] text-[12px] text-fg">
                                    <Icon name="chevronDown" size={12} className="text-faint" />
                                    {dir}
                                </p>
                                {files.map((path) => (
                                    <p key={path} className="flex items-center gap-1.5 truncate py-[2px] pl-7 pr-2 text-[12px] text-muted">
                                        <span className={`size-1.5 shrink-0 rounded-full ${DOT.has(roleOf(path)) ? `role-${roleOf(path)}` : 'bg-line-strong'}`} />
                                        <span className="truncate">{path.slice(path.lastIndexOf('/') + 1)}</span>
                                    </p>
                                ))}
                            </div>
                        ))}
                    </div>

                    {/* Editor: the Impact & plan view */}
                    <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex h-8 shrink-0 border-b border-line bg-panel text-[11.5px]">
                            <span className="flex items-center gap-1.5 border-r border-line px-3 text-muted">
                                <Icon name="overview" size={12} /> Overview
                            </span>
                            <span className="flex items-center gap-1.5 border-r border-line bg-bg px-3 text-fg">
                                <Icon name="impact" size={12} className="text-accent" /> Impact &amp; plan
                            </span>
                            <span className="hidden items-center gap-1.5 border-r border-line px-3 text-muted sm:flex">
                                <Icon name="file" size={12} /> db.ts
                            </span>
                        </div>
                        <div className="min-h-0 flex-1 overflow-hidden p-4">
                            <div className="flex h-8 items-center rounded-md border border-line-strong bg-panel px-3 text-[12.5px] text-fg">{SAMPLE_IMPACT.query}</div>
                            <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-2.5">
                                <div className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-bad">
                                    <p className="text-[9.5px] font-semibold uppercase tracking-wider opacity-80">Risk</p>
                                    <p className="text-lg font-semibold uppercase leading-tight">{SAMPLE_IMPACT.risk}</p>
                                </div>
                                <div className="rounded-md border border-line bg-panel px-3 py-2">
                                    <p className="text-[12.5px] text-muted">
                                        <span className="font-mono text-base font-semibold text-fg">{SAMPLE_IMPACT.total}</span> potentially affected files
                                    </p>
                                    <p className="mt-0.5 truncate text-[11px] text-faint">{SAMPLE_IMPACT.groups.map((g) => `${g.files.length} ${g.label.toLowerCase()}`).join(' · ')}</p>
                                </div>
                            </div>
                            <div className="mt-3 rounded-md border border-accent/40 bg-panel">
                                <p className="flex items-center gap-1.5 border-b border-line bg-mark px-3 py-1.5 text-[12px] font-semibold text-fg">
                                    <Icon name="plan" size={13} className="text-accent" /> Implementation plan
                                </p>
                                <ol className="space-y-1.5 px-3 py-2.5">
                                    {plan.map((step, i) => (
                                        <li key={step.title} className="flex gap-2 text-[12px]">
                                            <span className="font-mono text-faint">{i + 1}</span>
                                            <span className="min-w-0 truncate text-fg">
                                                {step.title}
                                                {step.files[0] && <span className="ml-1.5 font-mono text-[11px] text-faint">{step.files[0]}</span>}
                                            </span>
                                        </li>
                                    ))}
                                </ol>
                                <div className="px-3 pb-3">
                                    <span className="inline-flex items-center gap-1.5 rounded bg-accent px-2.5 py-1 text-[11.5px] font-semibold text-accent-fg">
                                        <Icon name="code" size={12} /> Work on this in VS Code
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Status bar */}
                <div className="flex h-6 items-center gap-4 border-t border-line bg-panel px-3 font-mono text-[10.5px] text-faint">
                    <span className="flex items-center gap-1">
                        <Icon name="branch" size={11} /> {SAMPLE.meta.ref}
                    </span>
                    {SAMPLE.language && (
                        <span>
                            {SAMPLE.language.name} {Math.round(SAMPLE.language.share * 100)}%
                        </span>
                    )}
                    {SAMPLE.stack.slice(0, 2).map((s) => (
                        <span key={s.value}>{s.value}</span>
                    ))}
                    <span className="hidden sm:inline">
                        {SAMPLE.readCount} of {SAMPLE.fileCount} files read
                    </span>
                    <span className="ml-auto flex items-center gap-1">
                        <Icon name="shield" size={11} /> read-only
                    </span>
                </div>
            </div>
            <figcaption className="mt-3 flex flex-wrap items-center justify-center gap-x-2 text-center text-[12.5px] text-faint">
                Real output — Project Brain on github.com/{SAMPLE.meta.owner}/{SAMPLE.meta.repo}.
                <Link href={live} className="text-muted underline underline-offset-4 hover:text-fg">
                    Open it live
                </Link>
            </figcaption>
        </figure>
    );
}
