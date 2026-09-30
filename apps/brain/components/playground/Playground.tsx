'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { strToU8, zipSync } from 'fflate';
import { Icon } from '@/components/icons';
import { KeyPanel } from '@/components/KeyPanel';
import { Logo } from '@/components/Logo';
import { RunPanel, startScript, toTree } from '@/components/workbench/RunPanel';
import { useOwnKey } from '@/lib/keys';
import { STARTERS, starterById } from '@/lib/starters';

/**
 * A project that starts from nothing — no GitHub, no sign-in. Pick a starter or
 * describe what you want; the agent writes the files, the editor lets you
 * change them, and Run shows it working, all in this tab. The project lives in
 * this browser's storage and leaves only when you download it.
 */

interface Project {
    name: string;
    files: Record<string, string>;
    active?: string;
}
interface Turn {
    role: 'user' | 'assistant';
    content: string;
    changed?: string[];
    model?: string;
}

const STORAGE = 'fac.playground.v1';
const HISTORY = 'fac.playground.chat.v1';

function loadSaved<T>(key: string): T | undefined {
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : undefined;
    } catch {
        return undefined;
    }
}
function save(key: string, value: unknown): void {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Storage full or blocked: the project still works for this visit.
    }
}

/** A small editor: line numbers, Tab indents, nothing to load. */
function Editor({ value, onChange }: { value: string; onChange: (next: string) => void }) {
    const lines = value.split('\n').length;
    const gutter = useRef<HTMLDivElement>(null);
    return (
        <div className="flex min-h-0 flex-1 overflow-hidden bg-bg font-mono text-[13px] leading-[1.6]">
            <div ref={gutter} className="shrink-0 select-none overflow-hidden border-r border-line px-3 py-3 text-right text-faint" aria-hidden>
                {Array.from({ length: lines }, (_, i) => (
                    <div key={i}>{i + 1}</div>
                ))}
            </div>
            <textarea
                value={value}
                spellCheck={false}
                onChange={(e) => onChange(e.target.value)}
                onScroll={(e) => {
                    if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
                }}
                onKeyDown={(e) => {
                    if (e.key !== 'Tab') return;
                    e.preventDefault();
                    const el = e.currentTarget;
                    const { selectionStart: start, selectionEnd: end } = el;
                    onChange(`${value.slice(0, start)}  ${value.slice(end)}`);
                    requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2));
                }}
                className="scroll-thin min-h-0 flex-1 resize-none bg-transparent px-3 py-3 text-fg outline-none"
                aria-label="File contents"
            />
        </div>
    );
}

function Start({ onPick }: { onPick: (starter: string, request?: string) => void }) {
    const [idea, setIdea] = useState('');
    return (
        <div className="mx-auto w-full max-w-3xl px-4 py-16">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-accent">Playground</p>
            <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-fg">Build something from nothing.</h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
                Describe it, and the agent writes it. Edit anything, and see it running — all in this tab. No GitHub and no sign-in; the project stays in your
                browser until you download it.
            </p>
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    if (idea.trim()) onPick('react', idea.trim());
                }}
                className="mt-8 flex gap-2 rounded-xl border border-line-strong bg-panel p-3"
            >
                <input
                    value={idea}
                    onChange={(e) => setIdea(e.target.value)}
                    autoFocus
                    placeholder="A pomodoro timer with a task list, dark theme"
                    aria-label="What to build"
                    className="h-11 min-w-0 flex-1 rounded-md bg-transparent px-2 text-[15px] text-fg outline-none placeholder:text-faint"
                />
                <button type="submit" className="h-11 shrink-0 rounded-md bg-accent px-5 text-[14px] font-semibold text-accent-fg hover:brightness-110">
                    Build it
                </button>
            </form>
            <p className="mt-10 text-[12px] font-semibold uppercase tracking-wider text-faint">Or start from</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {STARTERS.map((s) => (
                    <button
                        key={s.id}
                        type="button"
                        onClick={() => onPick(s.id)}
                        className="rounded-xl border border-line bg-panel p-5 text-left transition-colors hover:border-accent"
                    >
                        <span className="block text-[15px] font-semibold text-fg">{s.name}</span>
                        <span className="mt-1 block text-[13.5px] text-muted">{s.about}</span>
                    </button>
                ))}
            </div>
            <p className="mt-10 text-[13px] text-faint">
                Runs on desktop Chrome or Edge. JavaScript and TypeScript projects only — for anything else, the{' '}
                <Link href="/free-ai-coding-agent-vscode" className="text-accent hover:underline">
                    VS Code extension
                </Link>{' '}
                works in any language on your own machine.
            </p>
        </div>
    );
}

export function Playground() {
    const [project, setProject] = useState<Project>();
    const [turns, setTurns] = useState<Turn[]>([]);
    const [ready, setReady] = useState(false);
    const [prompt, setPrompt] = useState('');
    const [busy, setBusy] = useState(false);
    const [needKey, setNeedKey] = useState<string>();
    const [runOpen, setRunOpen] = useState(false);
    const [trial, setTrial] = useState<{ remaining: number; limit: number }>();
    const { own } = useOwnKey();
    const chatEnd = useRef<HTMLDivElement>(null);
    const pendingRequest = useRef<string | undefined>(undefined);

    useEffect(() => {
        setProject(loadSaved<Project>(STORAGE));
        setTurns(loadSaved<Turn[]>(HISTORY) ?? []);
        setReady(true);
    }, []);

    // Remember the project in this browser, a moment after the last change.
    useEffect(() => {
        if (!ready || !project) return;
        const timer = window.setTimeout(() => save(STORAGE, project), 400);
        return () => window.clearTimeout(timer);
    }, [project, ready]);
    useEffect(() => {
        if (ready) save(HISTORY, turns.slice(-40));
        chatEnd.current?.scrollIntoView({ block: 'end' });
    }, [turns, ready]);

    const files = project?.files ?? {};
    const paths = useMemo(() => Object.keys(files).sort((a, b) => a.localeCompare(b)), [files]);
    const active = project?.active && project.active in files ? project.active : paths.find((p) => /App\.|index\.html|server\./.test(p)) ?? paths[0];

    const send = useCallback(
        async (text: string, current: Project) => {
            setBusy(true);
            setNeedKey(undefined);
            setTurns((t) => [...t, { role: 'user', content: text }]);
            try {
                const headers: Record<string, string> = { 'content-type': 'application/json' };
                if (own) {
                    headers['x-brain-provider'] = own.provider;
                    headers['x-brain-key'] = own.key;
                }
                const response = await fetch('/api/playground', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ files: current.files, request: text, history: turns.slice(-8).map(({ role, content }) => ({ role, content })) }),
                });
                const data = (await response.json()) as {
                    error?: string;
                    needKey?: boolean;
                    message?: string;
                    files?: { path: string; content: string }[];
                    deletes?: string[];
                    model?: string;
                    access?: { mode: string; remaining?: number; limit?: number };
                };
                if (!response.ok) {
                    if (data.needKey) setNeedKey(data.error);
                    setTurns((t) => [...t, { role: 'assistant', content: data.error ?? 'Something went wrong. Try again.' }]);
                    return;
                }
                if (data.access?.mode === 'trial' && typeof data.access.remaining === 'number') {
                    setTrial({ remaining: data.access.remaining, limit: data.access.limit ?? 0 });
                }
                const changed = [...(data.files ?? []).map((f) => f.path), ...(data.deletes ?? [])];
                setProject((p) => {
                    const base = p ?? current;
                    const next = { ...base.files };
                    for (const f of data.files ?? []) next[f.path] = f.content;
                    for (const path of data.deletes ?? []) delete next[path];
                    return { ...base, files: next, active: data.files?.[0]?.path ?? base.active };
                });
                setTurns((t) => [...t, { role: 'assistant', content: data.message ?? 'Done.', changed, model: data.model }]);
            } catch {
                setTurns((t) => [...t, { role: 'assistant', content: 'Could not reach the agent. Check your connection and try again.' }]);
            } finally {
                setBusy(false);
            }
        },
        [own, turns],
    );

    // A request typed on the start screen goes out once the starter is in place.
    useEffect(() => {
        const request = pendingRequest.current;
        if (request && project && !busy) {
            pendingRequest.current = undefined;
            void send(request, project);
        }
    }, [project, busy, send]);

    if (!ready) return <div className="h-dvh bg-bg" />;

    if (!project) {
        return (
            <div className="min-h-dvh bg-bg">
                <header className="flex h-14 items-center gap-2 border-b border-line px-4">
                    <Link href="/" className="flex items-center gap-2 font-display text-[15px] font-semibold text-fg">
                        <Logo /> FreeAgentCoder
                    </Link>
                </header>
                <Start
                    onPick={(id, request) => {
                        const starter = starterById(id) ?? STARTERS[0]!;
                        pendingRequest.current = request;
                        setTurns([]);
                        setProject({ name: request ? request.slice(0, 40) : starter.name, files: { ...starter.files } });
                    }}
                />
            </div>
        );
    }

    const download = () => {
        const zipped = zipSync(Object.fromEntries(Object.entries(files).map(([path, content]) => [path, strToU8(content)])));
        const url = URL.createObjectURL(new Blob([zipped.slice().buffer as ArrayBuffer], { type: 'application/zip' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `${project.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'project'}.zip`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const addFile = () => {
        const path = window.prompt('New file path, for example src/utils.js')?.trim();
        if (!path || path in files || !/^(?![/\\])(?!.*\.\.)[\w@.\-/ ]{1,200}$/.test(path)) return;
        setProject({ ...project, files: { ...files, [path]: '' }, active: path });
    };
    const removeFile = (path: string) => {
        if (!window.confirm(`Delete ${path}?`)) return;
        const next = { ...files };
        delete next[path];
        setProject({ ...project, files: next });
    };

    return (
        <div className="flex h-dvh flex-col bg-bg">
            <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
                <Link href="/" className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
                    <Logo size={15} />
                    <span className="hidden sm:inline">FreeAgentCoder</span>
                </Link>
                <span className="text-faint">/</span>
                <span className="truncate text-[13px] text-muted">{project.name}</span>
                <div className="ml-auto flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setRunOpen((v) => !v)}
                        disabled={!startScript(files['package.json'])}
                        className={`flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium disabled:opacity-40 ${runOpen ? 'border-ok/40 bg-ok/10 text-ok' : 'border-line-strong text-fg hover:bg-panel-2'}`}
                    >
                        <span className={`size-1.5 rounded-full ${runOpen ? 'bg-ok' : 'bg-faint'}`} />
                        {runOpen ? 'Running' : 'Run'}
                    </button>
                    <button type="button" onClick={download} className="h-7 rounded-md border border-line-strong px-2.5 text-[12px] text-fg hover:bg-panel-2">
                        Download
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            if (!window.confirm('Start a new project? This one is deleted from this browser unless you download it first.')) return;
                            setRunOpen(false);
                            setProject(undefined);
                            setTurns([]);
                            try {
                                window.localStorage.removeItem(STORAGE);
                                window.localStorage.removeItem(HISTORY);
                            } catch {}
                        }}
                        className="h-7 rounded-md border border-line-strong px-2.5 text-[12px] text-muted hover:text-fg"
                    >
                        New
                    </button>
                </div>
            </header>

            <div className="flex min-h-0 flex-1">
                {/* Files */}
                <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-panel md:flex">
                    <div className="flex h-9 items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wider text-faint">
                        Files
                        <button type="button" onClick={addFile} title="New file" aria-label="New file" className="text-lg leading-none text-faint hover:text-fg">
                            +
                        </button>
                    </div>
                    <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-2">
                        {paths.map((path) => (
                            <li key={path} className="group flex items-center">
                                <button
                                    type="button"
                                    onClick={() => setProject({ ...project, active: path })}
                                    className={`flex min-w-0 flex-1 items-center gap-1.5 px-3 py-1 text-left font-mono text-[12.5px] ${path === active ? 'bg-panel-2 text-fg' : 'text-muted hover:text-fg'}`}
                                >
                                    <Icon name="file" size={13} className="shrink-0 text-faint" />
                                    <span className="truncate">{path}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => removeFile(path)}
                                    aria-label={`Delete ${path}`}
                                    className="px-2 text-faint opacity-0 hover:text-bad group-hover:opacity-100"
                                >
                                    ×
                                </button>
                            </li>
                        ))}
                    </ul>
                </aside>

                {/* Editor, with the running app beneath */}
                <main className="flex min-w-0 flex-1 flex-col">
                    <div className="flex h-9 shrink-0 items-center border-b border-line bg-panel px-3 font-mono text-[12.5px] text-muted">{active ?? 'No file open'}</div>
                    {active ? (
                        <Editor value={files[active] ?? ''} onChange={(next) => setProject({ ...project, files: { ...files, [active]: next } })} />
                    ) : (
                        <div className="flex flex-1 items-center justify-center text-[13px] text-faint">Ask the agent to build something.</div>
                    )}
                    {runOpen && (
                        <div className="h-[46%] min-h-[220px] shrink-0 border-t border-line bg-panel">
                            <RunPanel
                                load={async () => ({ files: toTree(files), run: startScript(files['package.json']) })}
                                live={files}
                                onClose={() => setRunOpen(false)}
                            />
                        </div>
                    )}
                </main>

                {/* Agent */}
                <aside className="flex w-full max-w-[380px] shrink-0 flex-col border-l border-line bg-panel">
                    <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3 text-[11px] font-semibold uppercase tracking-wider text-faint">
                        <span className="flex items-center gap-1.5">
                            <Icon name="spark" size={13} /> Agent
                        </span>
                        <span className="normal-case tracking-normal">
                            {own ? `Your ${own.provider} key` : trial ? `${trial.remaining} of ${trial.limit} free left today` : 'Free to try'}
                        </span>
                    </div>
                    <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                        {!turns.length && (
                            <p className="text-[13px] leading-relaxed text-muted">
                                Say what you want: “add a dark mode toggle”, “turn this into a todo app that saves to local storage”, “the button does nothing, fix
                                it”. Each change shows up in the files, and live in Run.
                            </p>
                        )}
                        {turns.map((turn, i) => (
                            <div key={i} className={turn.role === 'user' ? 'ml-6 rounded-lg bg-panel-2 px-3 py-2 text-[13.5px] text-fg' : 'text-[13.5px] leading-relaxed text-muted'}>
                                {turn.content}
                                {turn.changed?.length ? (
                                    <div className="mt-2 flex flex-wrap gap-1">
                                        {turn.changed.map((path) => (
                                            <button
                                                key={path}
                                                type="button"
                                                onClick={() => path in files && setProject({ ...project, active: path })}
                                                className="rounded border border-line px-1.5 py-0.5 font-mono text-[11.5px] text-accent hover:border-accent"
                                            >
                                                {path}
                                            </button>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        ))}
                        {busy && <p className="animate-pulse text-[13px] text-faint">Writing the code…</p>}
                        {needKey && (
                            <div className="rounded-lg border border-line bg-bg p-3">
                                <KeyPanel reason={needKey} onSaved={() => setNeedKey(undefined)} />
                            </div>
                        )}
                        <div ref={chatEnd} />
                    </div>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            const text = prompt.trim();
                            if (!text || busy) return;
                            setPrompt('');
                            void send(text, project);
                        }}
                        className="shrink-0 border-t border-line p-3"
                    >
                        <textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    e.currentTarget.form?.requestSubmit();
                                }
                            }}
                            rows={3}
                            placeholder="What should it build or change?"
                            aria-label="Message the agent"
                            className="w-full resize-none rounded-md border border-line-strong bg-bg px-3 py-2 text-[13.5px] text-fg outline-none placeholder:text-faint focus:border-accent"
                        />
                        <button
                            type="submit"
                            disabled={busy || !prompt.trim()}
                            className="mt-2 h-9 w-full rounded-md bg-accent text-[13.5px] font-semibold text-accent-fg hover:brightness-110 disabled:opacity-50"
                        >
                            {busy ? 'Working…' : 'Send'}
                        </button>
                    </form>
                </aside>
            </div>
        </div>
    );
}
