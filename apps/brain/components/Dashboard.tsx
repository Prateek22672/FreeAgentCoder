'use client';

/**
 * The Project Brain workbench, laid out like VS Code so it reads as a tool for
 * working on code: title bar with one command box, activity bar, explorer,
 * editor tabs for views and files, and a status bar of facts.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeWithProgress, type TabProps, type ViewId } from '@/lib/client';
import { providerById, useOwnKey } from '@/lib/keys';
import type { AnalyzeResponse } from '@/lib/types';
import { Icon, type IconName } from './icons';
import { AskTab } from './tabs/AskTab';
import { ImpactTab } from './tabs/ImpactTab';
import { ArchitectureTab, DependenciesTab, FilesTab, OverviewTab } from './tabs/InfoTabs';
import { SearchTab } from './tabs/SearchTab';
import { KeyPanel } from './KeyPanel';
import { ConfidenceBadge, Stat, cx } from './ui';
import { CodeEditor } from './workbench/CodeEditor';
import { Explorer } from './workbench/Explorer';
import { Progress, advance, initialSteps, type StepState } from './workbench/Progress';
import { SearchPanel } from './workbench/SearchPanel';

type Range = { start: number; end: number };
type Tab = { kind: 'view'; id: ViewId } | { kind: 'file'; path: string; lines?: Range };
const keyOf = (tab: Tab) => (tab.kind === 'view' ? `view:${tab.id}` : `file:${tab.path}`);

const VIEWS: { id: ViewId; label: string; short: string; icon: IconName; sidebar?: 'explorer' | 'search' }[] = [
    { id: 'overview', label: 'Overview', short: 'Overview', icon: 'overview' },
    { id: 'files', label: 'Explorer', short: 'Files', icon: 'files', sidebar: 'explorer' },
    { id: 'search', label: 'Search', short: 'Search', icon: 'search', sidebar: 'search' },
    { id: 'ask', label: 'Ask', short: 'Ask', icon: 'ask' },
    { id: 'impact', label: 'Impact & plan', short: 'Impact', icon: 'impact' },
    { id: 'architecture', label: 'Architecture', short: 'Layers', icon: 'layers' },
    { id: 'dependencies', label: 'Dependencies', short: 'Packages', icon: 'package' },
];
/** The rail, in groups: understand · explore · ask and plan · structure. */
const RAIL: ViewId[][] = [['overview'], ['files', 'search'], ['ask', 'impact'], ['architecture', 'dependencies']];
const SIDE_WIDTH = { min: 220, max: 520, fallback: 288, storage: 'projectBrain.sideWidth' };
const isView = (value: string | undefined): value is ViewId => VIEWS.some((v) => v.id === value);
const isDesktop = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;

type Mode = 'ask' | 'search' | 'impact';
const MODES: { id: Mode; label: string; placeholder: string }[] = [
    { id: 'ask', label: 'Ask', placeholder: 'Ask anything about this codebase…' },
    { id: 'search', label: 'Search', placeholder: 'Search the code…' },
    { id: 'impact', label: 'Change', placeholder: 'Describe a change to see what it touches…' },
];

function CommandBox({ ai, onRun }: { ai: boolean; onRun: (mode: Mode, text: string) => void }) {
    const [mode, setMode] = useState<Mode>(ai ? 'ask' : 'search');
    const [text, setText] = useState('');
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                input.current?.focus();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);
    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                if (!text.trim()) return;
                onRun(mode, text.trim());
                setText('');
            }}
            className="flex h-7 w-full max-w-xl items-center overflow-hidden rounded-md border border-line bg-bg focus-within:border-accent"
        >
            <div className="flex h-full shrink-0 border-r border-line">
                {MODES.map((m) => (
                    <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                            setMode(m.id);
                            input.current?.focus();
                        }}
                        className={cx('px-2 text-[11.5px]', mode === m.id ? 'bg-panel-2 text-fg' : 'text-faint hover:text-fg')}
                        aria-pressed={mode === m.id}
                    >
                        {m.label}
                    </button>
                ))}
            </div>
            <input
                ref={input}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={MODES.find((m) => m.id === mode)?.placeholder}
                aria-label="Command"
                className="h-full min-w-0 flex-1 bg-transparent px-2 text-[12.5px] text-fg placeholder:text-faint focus:outline-none"
            />
            <kbd className="mr-1.5 hidden shrink-0 rounded border border-line px-1 font-mono text-[10px] text-faint sm:block">Ctrl K</kbd>
        </form>
    );
}

function TitleBar({ repo, data, onRun, onPlan }: { repo: string; data?: AnalyzeResponse; onRun: (mode: Mode, text: string) => void; onPlan: () => void }) {
    const [owner, name] = repo.split('/');
    return (
        <header className="flex h-10 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
            <Link href="/" className="flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-fg">
                <span className="text-accent">▣</span>
                <span className="hidden lg:inline">Project Brain</span>
            </Link>
            <span className="hidden min-w-0 items-center gap-1 truncate font-mono text-[12.5px] text-muted sm:flex">
                <span className="text-faint">/</span>
                {owner}
                <span className="text-faint">/</span>
                <span className="text-fg">{name?.split('/tree/')[0]}</span>
            </span>
            <div className="flex min-w-0 flex-1 justify-center">{data && <CommandBox ai={data.ai.length > 0} onRun={onRun} />}</div>
            {data && (
                <button type="button" onClick={onPlan} className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[12px] font-medium text-accent-fg hover:brightness-110">
                    <Icon name="code" size={14} />
                    <span className="hidden sm:inline">Plan a change</span>
                </button>
            )}
        </header>
    );
}

const AI_LABEL: Record<string, string> = { custom: 'your model', gemini: 'Gemini', mistral: 'Mistral', openrouter: 'OpenRouter', cerebras: 'Cerebras', groq: 'Groq' };

function StatusBar({ data }: { data?: AnalyzeResponse }) {
    const { own } = useOwnKey();
    if (!data) return <footer className="h-6 shrink-0 border-t border-line bg-panel" />;
    const a = data.analysis;
    const lang = a.languages.find((l) => l.share > 0);
    return (
        <footer className="flex h-6 shrink-0 items-center gap-4 overflow-hidden whitespace-nowrap border-t border-line bg-panel px-3 font-mono text-[11px] text-faint">
            <span className="flex items-center gap-1 text-muted">
                <Icon name="branch" size={12} /> {a.meta.ref}
            </span>
            {lang && (
                <span>
                    {lang.name} {Math.round(lang.share * 100)}%
                </span>
            )}
            {a.frameworks.slice(0, 2).map((f) => (
                <span key={f.value}>{f.value}</span>
            ))}
            <span className="hidden sm:inline">
                {a.readCount.toLocaleString()} of {a.fileCount.toLocaleString()} files read
            </span>
            <span className="ml-auto hidden items-center gap-1 md:flex">
                <Icon name="shield" size={12} /> read-only
            </span>
            <span className={cx('flex items-center gap-1', own || data.ai.length ? 'text-ok' : 'text-warn')}>
                <span className={cx('size-1.5 rounded-full', own || data.ai.length ? 'bg-ok' : 'bg-warn')} />
                {own ? `AI: your ${providerById(own.provider)?.label ?? own.provider} key` : data.ai.length ? `AI: free trial (${AI_LABEL[data.ai[0]!] ?? data.ai[0]})` : 'AI: add your key'}
            </span>
        </footer>
    );
}

/** `initialTab` and `initialQuery` come from ?tab=impact&q=…, so an analysis can be linked to. */
export function Dashboard({ repo, initialTab, initialQuery }: { repo: string; initialTab?: string; initialQuery?: string }) {
    const [data, setData] = useState<AnalyzeResponse>();
    const [error, setError] = useState<string>();
    const [steps, setSteps] = useState<StepState[]>(initialSteps);
    const [tabs, setTabs] = useState<Tab[]>(() => [
        { kind: 'view', id: 'overview' },
        ...(isView(initialTab) && initialTab !== 'overview' ? [{ kind: 'view' as const, id: initialTab }] : []),
    ]);
    const [active, setActive] = useState(() => `view:${isView(initialTab) ? initialTab : 'overview'}`);
    const [sidebar, setSidebar] = useState<'explorer' | 'search' | null>('explorer');
    const [prefill, setPrefill] = useState<{ view: ViewId; text?: string; file?: string; key: number } | undefined>(() =>
        isView(initialTab) && initialQuery ? { view: initialTab, text: initialQuery, key: 1 } : undefined,
    );
    const [searchQuery, setSearchQuery] = useState<{ text: string; key: number }>();
    const [keysOpen, setKeysOpen] = useState(false);
    const { own } = useOwnKey();
    const [sideWidth, setSideWidth] = useState(SIDE_WIDTH.fallback);

    useEffect(() => {
        try {
            const saved = Number(window.localStorage.getItem(SIDE_WIDTH.storage));
            if (saved >= SIDE_WIDTH.min && saved <= SIDE_WIDTH.max) setSideWidth(saved);
        } catch {
            // storage unavailable: keep the default width
        }
    }, []);

    const startResize = (event: React.PointerEvent) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = sideWidth;
        let width = startWidth;
        const move = (e: PointerEvent) => {
            width = Math.max(SIDE_WIDTH.min, Math.min(SIDE_WIDTH.max, startWidth + e.clientX - startX));
            setSideWidth(width);
        };
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            try {
                window.localStorage.setItem(SIDE_WIDTH.storage, String(width));
            } catch {
                // not remembered this time
            }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    };

    const analyze = useCallback(async (): Promise<string> => {
        const result = await analyzeWithProgress(repo, (event) => setSteps((current) => advance(current, event)));
        setData(result);
        return result.id;
    }, [repo]);

    const start = useCallback(() => {
        setError(undefined);
        setData(undefined);
        setSteps(initialSteps());
        analyze().catch((e: Error) => setError(e.message));
    }, [analyze]);

    useEffect(() => {
        start();
    }, [start]);

    const known = useMemo(() => new Set(data?.readPaths ?? []), [data]);

    const openTab = useCallback((tab: Tab) => {
        const key = keyOf(tab);
        setTabs((all) => (all.some((t) => keyOf(t) === key) ? all.map((t) => (keyOf(t) === key ? tab : t)) : [...all, tab]));
        setActive(key);
    }, []);

    const open = useCallback((path: string, lines?: Range) => openTab({ kind: 'file', path, lines }), [openTab]);

    const goTo = useCallback(
        (view: ViewId, text?: string, file?: string) => {
            const entry = VIEWS.find((v) => v.id === view);
            if (entry?.sidebar && isDesktop()) {
                setSidebar(entry.sidebar);
                if (view === 'search' && text) setSearchQuery({ text, key: Date.now() });
                return;
            }
            if (text || file) setPrefill({ view, text, file, key: Date.now() });
            openTab({ kind: 'view', id: view });
        },
        [openTab],
    );

    const close = (key: string) => {
        setTabs((all) => {
            const index = all.findIndex((t) => keyOf(t) === key);
            const next = all.filter((t) => keyOf(t) !== key);
            if (key === active) setActive(keyOf(next[Math.max(0, index - 1)] ?? { kind: 'view', id: 'overview' }));
            return next;
        });
    };

    const runCommand = (mode: Mode, text: string) => goTo(mode === 'ask' ? 'ask' : mode === 'search' ? 'search' : 'impact', text);

    const props = (view: ViewId): TabProps | undefined =>
        data
            ? {
                  data,
                  known,
                  open,
                  reanalyze: analyze,
                  goTo,
                  ...(prefill?.view === view ? { prefill: prefill.text, prefillFile: prefill.file, prefillKey: prefill.key } : {}),
              }
            : undefined;

    const activeFile = active.startsWith('file:') ? active.slice(5) : undefined;
    const hiddenFiles = data ? data.analysis.fileCount - data.analysis.readCount : 0;

    return (
        <div className="flex h-dvh flex-col bg-bg">
            <TitleBar repo={repo} data={data} onRun={runCommand} onPlan={() => goTo('impact')} />

            {/* Phones: the activity bar becomes a strip of views. */}
            {data && (
                <nav className="scroll-thin flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-panel px-2 md:hidden" aria-label="Views">
                    {VIEWS.map((v) => (
                        <button
                            key={v.id}
                            type="button"
                            onClick={() => {
                                if (v.id === 'search') setPrefill(undefined);
                                openTab({ kind: 'view', id: v.id });
                            }}
                            className={cx('flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 text-[12.5px]', active === `view:${v.id}` ? 'border-accent text-fg' : 'border-transparent text-muted')}
                        >
                            <Icon name={v.icon} size={14} /> {v.label}
                        </button>
                    ))}
                </nav>
            )}

            <div className="flex min-h-0 flex-1">
                {/* Activity rail: labelled, grouped, with the key status at the bottom. */}
                <nav className="hidden w-[68px] shrink-0 flex-col border-r border-line bg-panel py-2 md:flex" aria-label="Views">
                    {RAIL.map((group, g) => (
                        <div key={g} className={cx('flex flex-col items-center gap-0.5 px-1.5', g > 0 && 'mt-1.5 border-t border-line pt-1.5')}>
                            {group.map((id) => {
                                const v = VIEWS.find((view) => view.id === id)!;
                                const selected = v.sidebar ? sidebar === v.sidebar : active === `view:${v.id}`;
                                return (
                                    <button
                                        key={v.id}
                                        type="button"
                                        disabled={!data}
                                        title={v.label}
                                        aria-label={v.label}
                                        aria-pressed={selected}
                                        onClick={() => (v.sidebar ? setSidebar(sidebar === v.sidebar ? null : v.sidebar) : goTo(v.id))}
                                        className={cx(
                                            'relative flex w-full flex-col items-center gap-0.5 rounded-md py-1.5 transition-colors disabled:opacity-30',
                                            selected ? 'bg-panel-2 text-fg' : 'text-faint hover:bg-panel-2/60 hover:text-fg',
                                        )}
                                    >
                                        {selected && <span className="absolute inset-y-1.5 -left-1.5 w-0.5 rounded-full bg-accent" />}
                                        <Icon name={v.icon} size={19} className={selected ? 'text-accent' : ''} />
                                        <span className="text-[10px] leading-tight">{v.short}</span>
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                    <div className="mt-auto flex flex-col items-center gap-0.5 px-1.5">
                        <button
                            type="button"
                            onClick={() => setKeysOpen(true)}
                            disabled={!data}
                            title="Your AI key"
                            className="relative flex w-full flex-col items-center gap-0.5 rounded-md py-1.5 text-faint hover:bg-panel-2/60 hover:text-fg disabled:opacity-30"
                        >
                            <span className={cx('absolute right-3 top-1.5 size-1.5 rounded-full', own ? 'bg-ok' : 'bg-warn')} />
                            <Icon name="shield" size={19} />
                            <span className="text-[10px] leading-tight">{own ? 'Your key' : 'Add key'}</span>
                        </button>
                        <Link href="/" title="Analyze another repository" className="flex w-full flex-col items-center gap-0.5 rounded-md py-1.5 text-faint hover:bg-panel-2/60 hover:text-fg">
                            <Icon name="arrowRight" size={19} className="rotate-180" />
                            <span className="text-[10px] leading-tight">New repo</span>
                        </Link>
                    </div>
                </nav>

                {/* Side bar, resizable by its right edge. */}
                {sidebar && (
                    <aside className="relative hidden shrink-0 flex-col border-r border-line bg-panel md:flex" style={{ width: sideWidth }}>
                        <div className="min-h-0 flex-1">
                            {!data ? (
                                <div className="space-y-2 px-3 pt-4" aria-hidden>
                                    {[70, 55, 80, 45, 65, 50, 75, 40].map((w, i) => (
                                        <div key={i} className="h-3 animate-pulse rounded bg-panel-2" style={{ width: `${w}%`, marginLeft: (i % 3) * 12 }} />
                                    ))}
                                </div>
                            ) : sidebar === 'explorer' ? (
                                <Explorer
                                    repo={`${data.analysis.meta.owner}/${data.analysis.meta.repo}`}
                                    paths={data.readPaths}
                                    hidden={hiddenFiles}
                                    active={activeFile}
                                    onOpen={(path) => open(path)}
                                    onCollapse={() => setSidebar(null)}
                                />
                            ) : (
                                <div className="flex h-full min-h-0 flex-col">
                                    <div className="px-3 pb-2 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Search</div>
                                    <div className="min-h-0 flex-1">
                                        <SearchPanel data={data} open={open} reanalyze={analyze} query={searchQuery?.text} queryKey={searchQuery?.key} />
                                    </div>
                                </div>
                            )}
                        </div>
                        <div
                            role="separator"
                            aria-orientation="vertical"
                            aria-label="Resize the side bar"
                            onPointerDown={startResize}
                            className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize hover:bg-accent/30"
                        />
                    </aside>
                )}

                {/* Editor */}
                <main className="flex min-w-0 flex-1 flex-col">
                    {!data ? (
                        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
                            <Progress repo={repo.split('/tree/')[0] ?? repo} steps={steps} error={error} onRetry={start} />
                        </div>
                    ) : (
                        <>
                            <div className="scroll-thin flex h-9 shrink-0 overflow-x-auto border-b border-line bg-panel" role="tablist">
                                {tabs.map((tab) => {
                                    const key = keyOf(tab);
                                    const view = tab.kind === 'view' ? VIEWS.find((v) => v.id === tab.id) : undefined;
                                    const label = view ? view.label : tab.kind === 'file' ? tab.path.slice(tab.path.lastIndexOf('/') + 1) : '';
                                    return (
                                        <div
                                            key={key}
                                            className={cx('group flex shrink-0 items-center border-r border-line text-[12.5px]', key === active ? 'bg-bg text-fg' : 'text-muted hover:text-fg')}
                                            title={tab.kind === 'file' ? tab.path : undefined}
                                        >
                                            <button type="button" role="tab" aria-selected={key === active} onClick={() => setActive(key)} className="flex h-full items-center gap-1.5 pl-3 pr-1">
                                                <Icon name={view ? view.icon : 'file'} size={13} className={key === active ? 'text-accent' : ''} />
                                                {label}
                                            </button>
                                            {key !== 'view:overview' ? (
                                                <button type="button" onClick={() => close(key)} aria-label={`Close ${label}`} className="mr-1 rounded p-0.5 text-faint opacity-60 hover:bg-panel-2 hover:text-fg group-hover:opacity-100">
                                                    <Icon name="close" size={12} />
                                                </button>
                                            ) : (
                                                <span className="w-2" />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="relative min-h-0 flex-1">
                                {tabs.map((tab) => {
                                    const key = keyOf(tab);
                                    return (
                                        <div key={key} className={cx('absolute inset-0', key === active ? 'block' : 'hidden')}>
                                            {tab.kind === 'file' ? (
                                                <CodeEditor
                                                    brainId={data.id}
                                                    path={tab.path}
                                                    lines={tab.lines}
                                                    onImpact={(path) => goTo('impact', undefined, path)}
                                                    onAsk={(question) => goTo('ask', question)}
                                                />
                                            ) : (
                                                <div className="scroll-thin h-full overflow-y-auto">
                                                    <div className="px-4 py-6 sm:px-6">
                                                        <ViewBody id={tab.id} props={props(tab.id)!} />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </main>
            </div>

            <StatusBar data={data} />

            {keysOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16 backdrop-blur-sm"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Your AI key"
                    onClick={() => setKeysOpen(false)}
                >
                    <div className="w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
                        <KeyPanel onSaved={() => setKeysOpen(false)} />
                        <button type="button" onClick={() => setKeysOpen(false)} className="mt-3 w-full text-center text-[13px] text-muted hover:text-fg">
                            Close
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function ViewBody({ id, props }: { id: ViewId; props: TabProps }) {
    const a = props.data.analysis;
    switch (id) {
        case 'overview':
            return (
                <div className="mx-auto max-w-6xl">
                    <div className="mb-5">
                        <h1 className="font-mono text-xl font-semibold text-fg">{a.meta.repo}</h1>
                        {a.meta.description && <p className="mt-1 max-w-3xl text-sm text-muted">{a.meta.description}</p>}
                    </div>
                    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
                        <Stat label="Files" value={a.fileCount.toLocaleString()} hint="Every file after dependency and build folders were dropped" />
                        <Stat label="Components" value={a.roles.component} />
                        <Stat label="API routes" value={a.roles.api} />
                        <Stat label="Models" value={a.roles.model} />
                        <Stat label="Services" value={a.roles.service} />
                        <Stat label="Tests" value={a.roles.test} />
                        <Stat label="Dependencies" value={a.dependencies.length} />
                    </div>
                    <OverviewTab {...props} />
                    <p className="mt-10 flex flex-wrap items-center gap-2 text-xs text-faint">
                        <ConfidenceBadge value="detected" /> read from the repository
                        <ConfidenceBadge value="inferred" /> deduced from strong signals
                        <ConfidenceBadge value="estimated" /> a heuristic
                    </p>
                </div>
            );
        case 'architecture':
            return <ArchitectureTab {...props} />;
        case 'ask':
            return <AskTab {...props} />;
        case 'search':
            return <SearchTab {...props} />;
        case 'impact':
            return <ImpactTab {...props} />;
        case 'dependencies':
            return (
                <div className="mx-auto max-w-4xl">
                    <DependenciesTab {...props} />
                </div>
            );
        case 'files':
            return <FilesTab {...props} />;
    }
}
