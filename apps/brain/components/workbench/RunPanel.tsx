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

export function RunPanel({ load, live, onClose }: { load: () => Promise<RunSource>; live?: Record<string, string>; onClose: () => void }) {
    const [stage, setStage] = useState<Stage>('checking');
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
                setStage('unsupported');
                setProblem('Running in the browser needs a desktop Chromium browser such as Chrome or Edge. Everything else on this page still works.');
                return;
            }
            try {
                setStage('booting');
                const { WebContainer } = await import('@webcontainer/api');
                const wc = await WebContainer.boot({ workdirName: 'project' });
                containerRef.current = wc as unknown as Container;
                if (cancelled) return;

                setStage('mounting');
                const source = await loadRef.current();
                if (!source.run) {
                    throw new Error('This project has no dev, start, serve or preview script in its package.json, so there is nothing to run.');
                }
                await wc.mount(source.files as never);
                syncedRef.current = { ...(live ?? {}) };
                if (source.skipped) say(`(${source.skipped} very large files were left out)`);
                say(`$ npm run ${source.run.script}   # ${source.run.command}`);

                wc.on('server-ready', (port, url) => {
                    if (HELPER_PORTS.has(port)) return;
                    setPreview(url);
                    setStage('ready');
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
            containerRef.current?.teardown();
            containerRef.current = undefined;
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
    }, [lines]);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
                <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
                    <Icon name="code" size={13} />
                    Run
                    <span className={stage === 'ready' ? 'normal-case tracking-normal text-ok' : stage === 'failed' || stage === 'unsupported' ? 'normal-case tracking-normal text-warn' : 'normal-case tracking-normal text-muted'}>
                        {STAGE_LABEL[stage]}
                    </span>
                </span>
                <div className="flex items-center gap-2">
                    {preview && (
                        <a href={preview} target="_blank" rel="noreferrer noopener" className="text-[12px] text-accent hover:underline">
                            Open in a tab ↗
                        </a>
                    )}
                    <button type="button" onClick={onClose} title="Stop and close" aria-label="Stop and close" className="text-faint hover:text-fg">
                        <Icon name="close" size={14} />
                    </button>
                </div>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
                <pre ref={logRef} className="scroll-thin m-0 min-h-0 overflow-auto border-r border-line bg-bg p-3 font-mono text-[12px] leading-relaxed text-muted">
                    {problem ? <span className="text-warn">{problem}{'\n'}</span> : null}
                    {lines.join('\n')}
                </pre>
                <div className="min-h-0 bg-white">
                    {preview ? (
                        <iframe src={preview} title="The running project" className="h-full w-full border-0" />
                    ) : (
                        <div className="flex h-full items-center justify-center bg-panel p-6 text-center text-[13px] text-faint">
                            {stage === 'ready' ? 'Waiting for the page…' : 'The preview appears here once the dev server starts.'}
                        </div>
                    )}
                </div>
            </div>
            <p className="shrink-0 border-t border-line px-3 py-1.5 text-[11px] text-faint">
                Runs entirely in your browser — nothing is executed on a server. Close this panel to stop it.
            </p>
        </div>
    );
}
