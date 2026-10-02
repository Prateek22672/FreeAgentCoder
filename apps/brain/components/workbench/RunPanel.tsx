'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';

/**
 * Runs a project in the visitor's own browser.
 *
 * No server is involved: a Node runtime boots inside the tab, the files are
 * mounted into it, `npm install` and the project's dev script run there, and
 * the dev server it starts is shown in a frame. That is the only way to offer
 * "see it running" that costs nothing per visitor.
 *
 * With `live`, later changes to the files are written into the running
 * container as they happen, so an edit — typed, or made by the agent — shows
 * up in the preview without a restart.
 *
 * Needs a cross-origin-isolated page and a desktop Chromium browser; Firefox
 * and Safari support is still marked beta by the runtime's authors.
 */

type Stage = 'checking' | 'unsupported' | 'booting' | 'mounting' | 'installing' | 'starting' | 'ready' | 'failed';

const STAGE_LABEL: Record<Stage, string> = {
    checking: 'Checking the browser…',
    unsupported: 'Not available in this browser',
    booting: 'Starting a Node runtime in this tab…',
    mounting: 'Copying the project in…',
    installing: 'Installing dependencies (this is the slow part)…',
    starting: 'Starting the dev server…',
    ready: 'Running',
    failed: 'Could not run',
};

/** Ports dev tooling opens beside the app, which are never the thing to show. */
const HELPER_PORTS = new Set([35729, 35730, 24678]);

/**
 * One runtime per tab: a panel that mounts while the last one is still
 * going (React mounts twice in development; a quick stop and run) waits for
 * that one to be torn down before it boots.
 */
let lastTeardown: Promise<void> = Promise.resolve();

export type FileTree = Record<string, { file: { contents: string } } | { directory: FileTree }>;

export interface RunSource {
    files: FileTree;
    run?: { script: string; command: string };
    skipped?: number;
}

/** Builds the tree the runtime mounts from a flat path → contents map. */
export function toTree(files: Record<string, string>): FileTree {
    const tree: FileTree = {};
    for (const [path, contents] of Object.entries(files)) {
        const parts = path.split('/');
        let node = tree;
        for (const part of parts.slice(0, -1)) {
            const existing = node[part];
            if (existing && 'directory' in existing) {
                node = existing.directory;
            } else {
                const directory: FileTree = {};
                node[part] = { directory };
                node = directory;
            }
        }
        node[parts[parts.length - 1]!] = { file: { contents } };
    }
    return tree;
}

/** The script a project starts with, if it has one. */
export function startScript(packageJson: string | undefined): RunSource['run'] {
    if (!packageJson) return undefined;
    try {
        const scripts = (JSON.parse(packageJson) as { scripts?: Record<string, string> }).scripts ?? {};
        for (const script of ['dev', 'start', 'serve', 'preview']) {
            if (scripts[script]) return { script, command: scripts[script]! };
        }
    } catch {
        // not a readable package.json
    }
    return undefined;
}

interface Container {
    teardown: () => void;
    fs: {
        writeFile: (path: string, data: string) => Promise<void>;
        mkdir: (path: string, options: { recursive: true }) => Promise<unknown>;
        rm: (path: string, options: { force: true; recursive: true }) => Promise<void>;
    };
}

export function RunPanel({ load, live, onClose, expanded, onExpand }: { load: () => Promise<RunSource>; live?: Record<string, string>; onClose: () => void; expanded?: boolean; onExpand?: () => void }) {
    const [stage, setStage] = useState<Stage>('checking');
    /** The terminal shows while it installs and starts, and when something fails. */
    const [terminal, setTerminal] = useState(true);
    const [lines, setLines] = useState<string[]>([]);
    const [preview, setPreview] = useState<string>();
    const [problem, setProblem] = useState<string>();
    const logRef = useRef<HTMLPreElement>(null);
    const containerRef = useRef<Container | undefined>(undefined);
    /** What the container holds, so live changes write only what differs. */
    const syncedRef = useRef<Record<string, string>>({});
    const loadRef = useRef(load);
    loadRef.current = load;

    const say = (line: string) =>
        setLines((prev) => {
            const next = [...prev, line];
            return next.length > 400 ? next.slice(-400) : next;
        });

    useEffect(() => {
        let cancelled = false;
        const booted = (async () => {
            await lastTeardown;
            const { WebContainer } = await import('@webcontainer/api');
            return WebContainer.boot({ workdirName: 'project' });
        })();

        const pipe = async (process: { output: ReadableStream<string>; exit: Promise<number> }) => {
            const reader = process.output.getReader();
            void (async () => {
                for (;;) {
                    const { value, done } = await reader.read();
                    if (done || cancelled) return;
                    // Terminal output arrives in chunks with control sequences; keep the readable part.
                    const clean = value.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
                    for (const line of clean.split('\n')) {
                        // npm's progress spinner arrives as lone glyphs on their own lines.
                        if (line.trim() && !/^[\\|/-]$/.test(line.trim())) say(line);
                    }
                }
            })();
            return process.exit;
        };

        (async () => {
            if (typeof window === 'undefined' || !window.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
                // Arriving here by an in-app link keeps the previous page's
                // isolation settings, which do not allow the runtime. A real
                // load of this page does; reload once, and only once.
                const flag = `fac.isolation-reload:${location.pathname}`;
                let reloaded = false;
                try {
                    reloaded = sessionStorage.getItem(flag) === '1';
                    if (!reloaded) sessionStorage.setItem(flag, '1');
                } catch {
                    reloaded = true;
                }
                if (!reloaded && typeof SharedArrayBuffer === 'undefined') {
                    location.reload();
                    return;
                }
                setStage('unsupported');
                setProblem('Running in the browser needs a desktop Chromium browser such as Chrome or Edge. Everything else on this page still works.');
                return;
            }
            try {
                sessionStorage.removeItem(`fac.isolation-reload:${location.pathname}`);
            } catch {}
            try {
                setStage('booting');
                const wc = await booted;
                if (cancelled) return;
                containerRef.current = wc as unknown as Container;

                setStage('mounting');
                const source = await loadRef.current();
                if (!source.run) {
                    throw new Error('This project has no dev, start, serve or preview script in its package.json, so there is nothing to run.');
                }
                await wc.mount(source.files as never);
                syncedRef.current = { ...(live ?? {}) };
                if (source.skipped) say(`(${source.skipped} very large files were left out)`);
                say(`$ npm run ${source.run.script}   # ${source.run.command}`);

                let explained = false;
                wc.on('server-ready', (port, url) => {
                    if (HELPER_PORTS.has(port)) return;
                    setPreview(url);
                    setStage('ready');
                    if (!explained) {
                        explained = true;
                        // The dev server prints a localhost address, which exists only inside this tab.
                        say(`→ Ready. The "localhost" address above is inside this browser tab, not your computer — use the preview, or Open in a tab.`);
                    }
                });
                wc.on('error', (error) => {
                    setProblem(error.message);
                    setStage('failed');
                });

                setStage('installing');
                say('$ npm install');
                const install = await wc.spawn('npm', ['install']);
                const code = await pipe(install);
                if (cancelled) return;
                if (code !== 0) {
                    throw new Error(`npm install exited with code ${code}. The output above usually says why.`);
                }

                setStage('starting');
                const dev = await wc.spawn('npm', ['run', source.run.script]);
                void pipe(dev);
            } catch (error) {
                if (cancelled) return;
                setProblem(error instanceof Error ? error.message : String(error));
                setStage('failed');
            }
        })();

        return () => {
            cancelled = true;
            containerRef.current = undefined;
            // Torn down once the boot settles, so the next panel can start.
            lastTeardown = booted.then(
                (wc) => wc.teardown(),
                () => undefined,
            );
        };
        // The container boots once per panel; later changes arrive through `live`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Write edits into the running container as they happen.
    useEffect(() => {
        const wc = containerRef.current;
        if (!live || !wc || stage === 'booting' || stage === 'mounting' || stage === 'checking') return;
        const before = syncedRef.current;
        const changed = Object.keys(live).filter((path) => before[path] !== live[path]);
        const removed = Object.keys(before).filter((path) => !(path in live));
        if (!changed.length && !removed.length) return;
        syncedRef.current = { ...live };
        void (async () => {
            const failed: string[] = [];
            for (const path of changed) {
                const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
                try {
                    if (dir) await wc.fs.mkdir(dir, { recursive: true });
                    await wc.fs.writeFile(path, live[path]!);
                } catch {
                    failed.push(path);
                }
            }
            for (const path of removed) await wc.fs.rm(path, { force: true, recursive: true }).catch(() => failed.push(path));
            const done = changed.length + removed.length - failed.length;
            if (done) say(`↻ applied ${done} change${done === 1 ? '' : 's'}: ${[...changed, ...removed].filter((p) => !failed.includes(p)).slice(0, 4).join(', ')}`);
            if (failed.length) say(`! could not apply: ${failed.join(', ')}`);
        })();
    }, [live, stage]);

    useEffect(() => {
        logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    }, [lines, terminal]);

    useEffect(() => {
        if (stage === 'ready') setTerminal(false);
        if (stage === 'failed' || stage === 'unsupported') setTerminal(true);
    }, [stage]);

    const working = stage !== 'ready' && stage !== 'failed' && stage !== 'unsupported';
    const trouble = stage === 'failed' || stage === 'unsupported';
    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="relative min-h-0 flex-1 bg-white">
                {preview ? (
                    <iframe src={preview} title="The running project" className="h-full w-full border-0" />
                ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-3 bg-panel p-6 text-center">
                        {working && <span className="inline-block size-5 animate-spin rounded-full border-2 border-line border-t-accent" />}
                        <p className={`text-[13px] font-medium ${trouble ? 'text-warn' : 'text-fg'}`}>{STAGE_LABEL[stage]}</p>
                        {problem && <p className="max-w-[360px] text-[12.5px] leading-relaxed text-muted">{problem}</p>}
                        {working && <p className="text-[12px] text-faint">The first run installs packages, which takes a minute. Later runs are quick.</p>}
                    </div>
                )}
            </div>
            {terminal && (
                <pre ref={logRef} className="scroll-thin m-0 h-44 shrink-0 overflow-auto whitespace-pre-wrap break-words border-t border-line bg-bg p-3 font-mono text-[12px] leading-relaxed text-muted">
                    {problem ? <span className="text-warn">{problem}{'\n'}</span> : null}
                    {lines.join('\n')}
                </pre>
            )}
            <div className="flex h-10 shrink-0 items-center gap-2 border-t border-line bg-panel px-2 text-[12px]">
                <button type="button" onClick={onClose} className="flex h-7 items-center gap-1.5 rounded-md border border-line-strong px-2.5 font-medium text-fg hover:bg-panel-2">
                    <span className={`size-1.5 rounded-full ${stage === 'ready' ? 'bg-ok' : working ? 'bg-warn' : 'bg-faint'}`} />
                    Stop
                </button>
                <span className={`truncate ${stage === 'ready' ? 'text-ok' : trouble ? 'text-warn' : 'text-muted'}`}>{STAGE_LABEL[stage]}</span>
                <span className="flex-1" />
                {preview && (
                    <a href={preview} target="_blank" rel="noreferrer noopener" className="hidden text-accent hover:underline sm:inline">
                        Open in a tab ↗
                    </a>
                )}
                <button
                    type="button"
                    onClick={() => setTerminal((v) => !v)}
                    aria-pressed={terminal}
                    className={`flex h-7 items-center gap-1.5 rounded-md px-2 ${terminal ? 'bg-panel-2 text-fg' : 'text-muted hover:text-fg'}`}
                >
                    <Icon name="code" size={13} /> Terminal
                </button>
                {onExpand && (
                    <button
                        type="button"
                        onClick={onExpand}
                        title={expanded ? 'Back to the editor' : 'Preview only'}
                        aria-label={expanded ? 'Back to the editor' : 'Preview only'}
                        className="hidden h-7 items-center rounded-md px-2 text-muted hover:text-fg lg:flex"
                    >
                        <Icon name={expanded ? 'close' : 'external'} size={13} />
                    </button>
                )}
            </div>
        </div>
    );
}
