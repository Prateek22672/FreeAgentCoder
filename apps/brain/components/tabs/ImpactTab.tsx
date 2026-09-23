'use client';

import { buildPlan, createTask, taskUrl } from '@agentic/project-brain';
import { useEffect, useMemo, useState } from 'react';
import { callBrain, type TabProps } from '@/lib/client';
import type { ImpactResult } from '@/lib/types';
import { Icon } from '../icons';
import { Button, ConfidenceBadge, Empty, FileLink, Panel, Spinner, TextInput, cx } from '../ui';

const RISK = {
    low: 'text-ok border-ok/40 bg-ok/10',
    medium: 'text-warn border-warn/40 bg-warn/10',
    high: 'text-bad border-bad/40 bg-bad/10',
};

const MARKETPLACE = 'https://marketplace.visualstudio.com/items?itemName=PrateekKoratala.freeagentcoder';

function FileList({ files, open, limit = 12 }: { files: string[]; open: TabProps['open']; limit?: number }) {
    const [all, setAll] = useState(false);
    const shown = all ? files : files.slice(0, limit);
    return (
        <ul className="space-y-1">
            {shown.map((path) => (
                <li key={path} className="min-w-0">
                    <FileLink path={path} onOpen={open} />
                </li>
            ))}
            {files.length > limit && (
                <li>
                    <button type="button" onClick={() => setAll(!all)} className="text-xs text-muted underline underline-offset-4 hover:text-fg">
                        {all ? 'Show fewer' : `Show all ${files.length}`}
                    </button>
                </li>
            )}
        </ul>
    );
}

/**
 * Where the change actually happens. Project Brain only reads; the edits are
 * made by the agent on the visitor's own copy, so the first step is to get one.
 */
function GetTheCode({ owner, repo }: { owner: string; repo: string }) {
    const url = `https://github.com/${owner}/${repo}`;
    const clone = `vscode://vscode.git/clone?url=${encodeURIComponent(`${url}.git`)}`;
    return (
        <div className="mb-5 rounded-md border border-line bg-bg p-3.5">
            <p className="flex items-center gap-2 text-[13.5px] font-medium text-fg">
                <span className="flex size-5 items-center justify-center rounded-full border border-line-strong font-mono text-[10.5px] text-muted">0</span>
                Get the code on your computer
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                Project Brain never changes a repository — it only reads it. The change is made by your agent on <em>your own copy</em>, in VS Code. Skip this if the project is
                already open there.
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <a href={clone} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong px-3 text-[12.5px] text-fg hover:bg-panel-2">
                    <Icon name="code" size={14} /> Clone in VS Code
                </a>
                <a href={`${url}/fork`} target="_blank" rel="noreferrer noopener" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong px-3 text-[12.5px] text-fg hover:bg-panel-2">
                    <Icon name="branch" size={14} /> Fork on GitHub
                </a>
                <code className="rounded bg-panel-2 px-2 py-1 font-mono text-[11.5px] text-muted">git clone {url}.git</code>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-faint">
                Not your repository? Fork it first and clone your fork. Your changes stay on your copy; to suggest them to the owner, push to your fork and open a pull request.
                Nothing is ever pushed without you.
            </p>
        </div>
    );
}

/** The plan, and the one click that hands it to the agent in VS Code. */
function PlanPanel({ result, data, open, seedFile }: { result: ImpactResult; data: TabProps['data']; open: TabProps['open']; seedFile?: string }) {
    const meta = data.analysis.meta;
    const [title, setTitle] = useState(seedFile ? `Change ${seedFile}` : result.query);
    const [copied, setCopied] = useState(false);
    useEffect(() => setTitle(seedFile ? `Change ${seedFile}` : result.query), [result, seedFile]);

    const plan = useMemo(() => buildPlan(result), [result]);
    const stack = [...data.analysis.frameworks, ...data.analysis.databases].map((f) => f.value).join(' · ');
    const task = useMemo(
        () => createTask({ repo: `${meta.owner}/${meta.repo}`, ref: meta.ref, title: title.trim() || result.query, impact: result, plan, stack }),
        [meta, title, result, plan, stack],
    );

    const copy = async () => {
        await navigator.clipboard.writeText(task.brief);
        setCopied(true);
        setTimeout(() => setCopied(false), 1_800);
    };

    return (
        <section className="overflow-hidden rounded-lg border border-accent/40 bg-panel">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-mark px-4 py-3">
                <div>
                    <h3 className="flex items-center gap-2 text-[14px] font-semibold text-fg">
                        <Icon name="plan" size={16} className="text-accent" /> Implementation plan
                    </h3>
                    <p className="mt-0.5 text-[12px] text-muted">Built from this analysis. Your VS Code agent carries it out, runs the project&apos;s checks, and shows you every edit.</p>
                </div>
            </header>
            <div className="p-4">
                <GetTheCode owner={meta.owner} repo={meta.repo} />

                <label className="block text-[11px] font-semibold uppercase tracking-wider text-faint" htmlFor="task-title">
                    Task for the agent
                </label>
                <TextInput id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1.5 h-9" />

                <ol className="mt-4 space-y-3">
                    {plan.map((step, i) => (
                        <li key={step.title} className="flex gap-3">
                            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong font-mono text-[11px] text-muted">{i + 1}</span>
                            <div className="min-w-0 flex-1">
                                <p className="text-[13.5px] font-medium text-fg">{step.title}</p>
                                <p className="mt-0.5 text-[12.5px] text-muted">{step.detail}</p>
                                {step.files.length > 0 && (
                                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                                        {step.files.map((path) => (
                                            <FileLink key={path} path={path} onOpen={open} />
                                        ))}
                                        {step.more > 0 && <span className="text-[12px] text-faint">+{step.more} more</span>}
                                    </div>
                                )}
                            </div>
                        </li>
                    ))}
                </ol>

                <div className="mt-6 flex flex-wrap items-center gap-2">
                    <a href={taskUrl(task)} className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-accent-fg hover:brightness-110">
                        <Icon name="code" size={16} /> Work on this in VS Code
                    </a>
                    <Button variant="outline" onClick={copy} className="h-10">
                        <Icon name={copied ? 'check' : 'copy'} size={15} /> {copied ? 'Copied' : 'Copy task'}
                    </Button>
                </div>
                <p className="mt-3 max-w-2xl text-[12px] leading-relaxed text-faint">
                    Opens FreeAgentCoder with this plan written into its chat. Nothing runs until you read it and press Send. Open this project&apos;s folder in VS Code first.
                    No extension yet?{' '}
                    <a href={MARKETPLACE} target="_blank" rel="noreferrer noopener" className="text-muted underline underline-offset-4 hover:text-fg">
                        Install FreeAgentCoder
                    </a>{' '}
                    — it&apos;s free.
                </p>
            </div>
        </section>
    );
}

export function ImpactTab({ data, open, reanalyze, prefill, prefillFile, prefillKey }: TabProps) {
    const [q, setQ] = useState(prefill ?? '');
    const [seedFile, setSeedFile] = useState<string | undefined>(prefillFile);
    const [result, setResult] = useState<ImpactResult>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string>();

    const run = async (query: string, file?: string) => {
        if (!query.trim() && !file) return;
        setBusy(true);
        setError(undefined);
        setSeedFile(file);
        try {
            setResult(await callBrain<ImpactResult>('/api/impact', file ? { file } : { q: query }, data.id, reanalyze));
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => {
        if (prefillFile) {
            setQ('');
            void run('', prefillFile);
        } else if (prefill) {
            setQ(prefill);
            void run(prefill);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prefillKey]);

    return (
        <div className="mx-auto max-w-5xl">
            <h2 className="text-lg font-semibold text-fg">What would a change touch?</h2>
            <p className="mt-1 text-sm text-muted">Describe a change. Project Brain traces it through the code and the import graph, then drafts a plan your VS Code agent can carry out.</p>
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    void run(q);
                }}
                className="mt-4 flex gap-2"
            >
                <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Replace MongoDB with PostgreSQL · Rename User.email to User.emailAddress" className="h-10" />
                <Button type="submit" disabled={busy || !q.trim()} className="h-10">
                    {busy ? <Spinner /> : 'Analyze impact'}
                </Button>
            </form>
            <p className="mt-2 text-xs text-faint">Runs locally on the analysis — no AI key needed, and nothing is changed.</p>
            {error && <p className="mt-4 text-sm text-bad">{error}</p>}

            {result?.empty && (
                <Empty>
                    Nothing in this repository mentions {result.terms.length ? result.terms.map((t) => `"${t}"`).join(', ') : 'that'}. Try the name of a file, function, class or package.
                </Empty>
            )}

            {result && !result.empty && (
                <div className="mt-6 space-y-4">
                    {seedFile && (
                        <p className="text-sm text-muted">
                            Everything that depends on <span className="font-mono text-fg">{seedFile}</span>, directly or through other files.
                        </p>
                    )}
                    <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
                        <div className={cx('rounded-lg border px-5 py-4', RISK[result.risk])}>
                            <div className="text-[11px] font-semibold uppercase tracking-wider opacity-80">Risk</div>
                            <div className="mt-1 text-2xl font-semibold uppercase">{result.risk}</div>
                        </div>
                        <div className="rounded-lg border border-line bg-panel px-5 py-4">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-2xl font-semibold tabular-nums">{result.total}</span>
                                <span className="text-sm text-muted">potentially affected files</span>
                                <ConfidenceBadge value="estimated" />
                            </div>
                            <p className="mt-1 text-sm text-muted">{result.riskReason}</p>
                            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
                                {result.groups.map((g) => (
                                    <span key={g.role}>
                                        <span className="font-mono tabular-nums text-fg">{g.files.length}</span> <span className="text-faint">{g.label.toLowerCase()}</span>
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>

                    <PlanPanel result={result} data={data} open={open} seedFile={seedFile} />

                    <div className="grid gap-4 lg:grid-cols-2">
                        <Panel title={<span className="flex items-center gap-2">{seedFile ? 'Starting file' : 'Directly affected'} · {result.direct.length} <ConfidenceBadge value="detected" /></span>}>
                            {!seedFile && <p className="mb-2 text-xs text-faint">These files mention {result.terms.slice(0, 4).map((t) => `"${t}"`).join(', ')}.</p>}
                            <FileList files={result.direct} open={open} />
                        </Panel>
                        <Panel title={<span className="flex items-center gap-2">Through imports · {result.dependents.length} <ConfidenceBadge value="inferred" /></span>}>
                            {result.dependents.length === 0 ? (
                                <Empty>No other file imports the directly affected ones.</Empty>
                            ) : (
                                <>
                                    <p className="mb-2 text-xs text-faint">These import an affected file, directly or up to three steps away. They may need no change.</p>
                                    <FileList files={result.dependents.map((d) => d.path)} open={open} />
                                </>
                            )}
                        </Panel>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-3">
                        <Panel title="By kind of code">
                            <ul className="space-y-2">
                                {result.groups.map((g) => (
                                    <li key={g.role}>
                                        <details>
                                            <summary className="flex cursor-pointer justify-between text-[13px]">
                                                <span className="text-fg">{g.label}</span>
                                                <span className="font-mono tabular-nums text-faint">{g.files.length}</span>
                                            </summary>
                                            <div className="mt-2 pl-2">
                                                <FileList files={g.files} open={open} limit={8} />
                                            </div>
                                        </details>
                                    </li>
                                ))}
                            </ul>
                        </Panel>
                        <Panel title="Areas">
                            <ul className="space-y-1.5">
                                {result.areas.map((area) => (
                                    <li key={area.name} className="flex justify-between gap-3 text-[13px]">
                                        <span className="truncate font-mono text-fg">{area.name}</span>
                                        <span className="font-mono tabular-nums text-faint">{area.files}</span>
                                    </li>
                                ))}
                            </ul>
                        </Panel>
                        <Panel title="Packages involved">
                            {result.externalPackages.length === 0 ? (
                                <Empty>No dependency named in the request.</Empty>
                            ) : (
                                <ul className="space-y-1.5">
                                    {result.externalPackages.map((p) => (
                                        <li key={p.name} className="flex justify-between gap-3 text-[13px]">
                                            <span className="truncate font-mono text-fg">{p.name}</span>
                                            <span className="shrink-0 text-faint">{p.files ? `imported by ${p.files}` : 'a tool, not imported'}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Panel>
                    </div>
                </div>
            )}
        </div>
    );
}
