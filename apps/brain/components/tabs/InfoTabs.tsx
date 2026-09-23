'use client';

import type { Finding, TreeNode } from '@agentic/project-brain';
import { useMemo, useState } from 'react';
import type { TabProps } from '@/lib/client';
import { ConfidenceBadge, Empty, FileLink, Panel, TextInput, cx } from '../ui';

function FindingRow({ label, findings }: { label: string; findings: Finding[] }) {
    return (
        <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 border-b border-line py-2.5 last:border-0 sm:grid-cols-[7rem_minmax(0,1fr)]">
            <div className="text-[13px] text-faint">{label}</div>
            <div className="min-w-0 space-y-1.5">
                {findings.length === 0 && <span className="text-[13px] text-faint">Not detected</span>}
                {findings.map((f) => (
                    <div key={f.value} className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-medium text-fg">{f.value}</span>
                        <ConfidenceBadge value={f.confidence} />
                        <span className="truncate font-mono text-[11px] text-faint" title={f.evidence.join('\n')}>
                            {f.evidence.join(' · ')}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function suggestions(props: TabProps): { ask: string[]; impact: string[] } {
    const a = props.data.analysis;
    const ask = ['What does this project do, and where does execution start?'];
    if (a.roles.api) ask.push('Which API routes exist and what does each one do?');
    if (a.databases.length) ask.push(`Where is ${a.databases[0]?.value} accessed, and through which files?`);
    if (a.roles.component) ask.push('How is the UI organized into components?');
    if (/auth/i.test(props.data.readPaths.join(' '))) ask.push('Where is authentication handled?');
    if (a.roles.test) ask.push('How are tests organized, and what do they cover?');
    const impact: string[] = [];
    if (a.databases[0]) impact.push(`Replace ${a.databases[0].value} with another database`);
    if (a.frameworks[0]) impact.push(`Upgrade ${a.frameworks[0].value} to its next major version`);
    impact.push('Change how authentication works');
    return { ask: ask.slice(0, 5), impact: impact.slice(0, 3) };
}

export function OverviewTab(props: TabProps) {
    const { data, open, goTo } = props;
    const a = data.analysis;
    const s = suggestions(props);
    const skipped = a.skipped;
    const skippedTotal = skipped.binary + skipped.generated + skipped.tooLarge + skipped.overLimit;

    return (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-w-0 space-y-4">
                {data.secrets.length > 0 && (
                    <div className="rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-sm">
                        <p className="font-medium text-bad">Possible secrets committed to this repository</p>
                        <p className="mt-1 text-muted">Values are not shown or sent anywhere. Check and rotate these if they are real:</p>
                        <ul className="mt-2 space-y-1">
                            {data.secrets.slice(0, 8).map((s) => (
                                <li key={s.path} className="flex gap-2 text-[13px]">
                                    <FileLink path={s.path} onOpen={open} /> <span className="text-faint">— {s.kind}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                <Panel title="Stack">
                    <FindingRow label="Frameworks" findings={a.frameworks} />
                    <FindingRow label="Data" findings={a.databases} />
                    <FindingRow label="Testing" findings={a.testing} />
                    <FindingRow label="Packages" findings={a.packageManager ? [a.packageManager] : []} />
                </Panel>

                <Panel title="Languages">
                    <div className="flex h-2 overflow-hidden rounded-full bg-panel-2">
                        {a.languages
                            .filter((l) => l.share > 0.005)
                            .map((l, i) => (
                                <div key={l.name} style={{ width: `${l.share * 100}%`, opacity: 1 - i * 0.14 }} className="bg-accent" title={`${l.name} ${Math.round(l.share * 100)}%`} />
                            ))}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
                        {a.languages.map((l) => (
                            <div key={l.name} className="flex justify-between text-[13px]">
                                <span className="text-fg">{l.name}</span>
                                <span className="font-mono tabular-nums text-faint">{l.share > 0 ? `${Math.round(l.share * 100)}%` : `${l.files} files`}</span>
                            </div>
                        ))}
                    </div>
                </Panel>

                <Panel title="Start reading here">
                    {a.importantFiles.length === 0 ? (
                        <Empty>No well-known entry files found.</Empty>
                    ) : (
                        <ul className="grid gap-1.5 sm:grid-cols-2">
                            {a.importantFiles.map((path) => (
                                <li key={path}>{props.known.has(path) ? <FileLink path={path} onOpen={open} /> : <span className="font-mono text-[13px] text-faint">{path}</span>}</li>
                            ))}
                        </ul>
                    )}
                </Panel>
            </div>

            <div className="space-y-4">
                <Panel title="Ask this codebase">
                    <div className="space-y-1.5">
                        {s.ask.map((q) => (
                            <button key={q} type="button" onClick={() => goTo('ask', q)} className="block w-full rounded-md border border-line px-3 py-2 text-left text-[13px] text-fg hover:border-accent hover:bg-panel-2">
                                {q}
                            </button>
                        ))}
                    </div>
                </Panel>
                <Panel title="What would a change touch?">
                    <div className="space-y-1.5">
                        {s.impact.map((q) => (
                            <button key={q} type="button" onClick={() => goTo('impact', q)} className="block w-full rounded-md border border-line px-3 py-2 text-left text-[13px] text-fg hover:border-accent hover:bg-panel-2">
                                {q}
                            </button>
                        ))}
                    </div>
                </Panel>
                <Panel title="What was read">
                    <dl className="space-y-1.5 text-[13px]">
                        {[
                            ['Files in repository', a.fileCount],
                            ['Read and indexed', a.readCount],
                            ['Binary or media', skipped.binary],
                            ['Lock files and generated', skipped.generated],
                            ['Over 512 KB', skipped.tooLarge],
                            ['Over the size budget', skipped.overLimit],
                            ['In dependency / build folders', skipped.ignoredDirs],
                        ].map(([label, value]) => (
                            <div key={label as string} className="flex justify-between">
                                <dt className="text-faint">{label}</dt>
                                <dd className="font-mono tabular-nums text-fg">{Number(value).toLocaleString()}</dd>
                            </div>
                        ))}
                    </dl>
                    {skippedTotal > 0 && <p className="mt-3 text-xs text-faint">Skipped files are counted and listed, but their content isn&apos;t read or sent to any model.</p>}
                </Panel>
            </div>
        </div>
    );
}

export function ArchitectureTab({ data, open }: TabProps) {
    const layers = data.analysis.architecture;
    if (!layers.length) return <Empty>No recognizable layers — this repository may be a library or a single script.</Empty>;
    return (
        <div className="mx-auto max-w-3xl">
            <div className="mb-4 flex items-center gap-2 text-sm text-muted">
                <ConfidenceBadge value="inferred" /> Layers are inferred from folder and file names, so a file can sit in the wrong one.
            </div>
            <ol className="space-y-0">
                {layers.map((layer, i) => (
                    <li key={layer.id}>
                        <div className="rounded-lg border border-line bg-panel p-4">
                            <div className="flex items-baseline justify-between gap-3">
                                <h3 className="font-medium text-fg">{layer.label}</h3>
                                <span className="font-mono text-sm tabular-nums text-faint">{layer.files} files</span>
                            </div>
                            <ul className="mt-2 space-y-1">
                                {layer.examples.map((path) => (
                                    <li key={path}>
                                        <FileLink path={path} onOpen={open} />
                                    </li>
                                ))}
                            </ul>
                        </div>
                        {i < layers.length - 1 && (
                            <div className="flex justify-center py-1 text-faint" aria-hidden>
                                ↓
                            </div>
                        )}
                    </li>
                ))}
            </ol>
        </div>
    );
}

export function DependenciesTab({ data }: TabProps) {
    const [filter, setFilter] = useState<'all' | 'prod' | 'dev'>('all');
    const [q, setQ] = useState('');
    const deps = data.analysis.dependencies.filter((d) => (filter === 'all' || d.kind === filter) && d.name.toLowerCase().includes(q.toLowerCase()));
    if (!data.analysis.dependencies.length) return <Empty>No dependency manifest (package.json, requirements.txt, Cargo.toml) at the repository root.</Empty>;
    return (
        <Panel
            title={`${data.analysis.dependencies.length} dependencies`}
            action={
                <div className="flex gap-1">
                    {(['all', 'prod', 'dev'] as const).map((f) => (
                        <button key={f} type="button" onClick={() => setFilter(f)} className={cx('rounded px-2 py-0.5 text-xs', filter === f ? 'bg-panel-2 text-fg' : 'text-faint hover:text-fg')}>
                            {f === 'all' ? 'All' : f === 'prod' ? 'Runtime' : 'Dev'}
                        </button>
                    ))}
                </div>
            }
        >
            <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" className="mb-3 h-9" />
            <table className="w-full text-[13px]">
                <tbody>
                    {deps.map((d) => (
                        <tr key={`${d.ecosystem}:${d.name}:${d.kind}`} className="border-b border-line last:border-0">
                            <td className="py-1.5 font-mono text-fg">{d.name}</td>
                            <td className="py-1.5 font-mono text-faint">{d.version}</td>
                            <td className="py-1.5 text-right text-faint">
                                {d.ecosystem} · {d.kind === 'prod' ? 'runtime' : 'dev'}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </Panel>
    );
}

function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
    const [expanded, setExpanded] = useState(depth < 1);
    const hasChildren = node.children.length > 0;
    return (
        <li>
            <button
                type="button"
                onClick={() => hasChildren && setExpanded(!expanded)}
                className={cx('flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left font-mono text-[13px]', hasChildren ? 'hover:bg-panel-2' : 'cursor-default')}
                style={{ paddingLeft: `${depth * 16 + 6}px` }}
            >
                <span className="w-3 text-faint">{hasChildren ? (expanded ? '▾' : '▸') : ''}</span>
                <span className="text-fg">{node.name}/</span>
                <span className="text-faint">{node.files}</span>
                {node.collapsed ? <span className="text-faint">· {node.collapsed} more folders</span> : null}
            </button>
            {expanded && hasChildren && (
                <ul>
                    {node.children.map((child) => (
                        <TreeRow key={child.path} node={child} depth={depth + 1} />
                    ))}
                </ul>
            )}
        </li>
    );
}

export function FilesTab({ data, open }: TabProps) {
    const [q, setQ] = useState('');
    const matches = useMemo(() => {
        const needle = q.trim().toLowerCase();
        return needle ? data.readPaths.filter((p) => p.toLowerCase().includes(needle)).slice(0, 80) : [];
    }, [q, data.readPaths]);
    return (
        <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Folders">
                <ul>
                    {data.analysis.tree.children.map((child) => (
                        <TreeRow key={child.path} node={child} depth={0} />
                    ))}
                </ul>
            </Panel>
            <Panel title="Find a file">
                <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Part of a path, e.g. auth or UserService" className="mb-3 h-9" />
                {q && matches.length === 0 && <Empty>No file path contains that.</Empty>}
                <ul className="space-y-1">
                    {matches.map((path) => (
                        <li key={path}>
                            <FileLink path={path} onOpen={open} />
                        </li>
                    ))}
                </ul>
            </Panel>
        </div>
    );
}
