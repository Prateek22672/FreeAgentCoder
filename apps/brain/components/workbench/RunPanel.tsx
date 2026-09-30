'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';

/**
 * Runs the repository in the visitor's own browser.
 *
 * No server is involved: a Node runtime boots inside the tab, the files are
 * mounted into it, `npm install` and the project's dev script run there, and
 * the dev server it starts is shown in a frame. That is the only way to offer
 * "see it running" that costs nothing per visitor, and it is exactly how the
 * app-builder platforms do it.
 *
 * Needs a cross-origin-isolated page (the headers are set for /r/*) and a
 * desktop Chromium browser; Firefox and Safari support is still marked beta by
 * the runtime's authors, and phones are not supported.
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

interface RunResponse {
    files: Record<string, unknown>;
    run?: { script: string; command: string };
    skipped: number;
    error?: string;
}

export function RunPanel({ id, onClose }: { id: string; onClose: () => void }) {
    const [stage, setStage] = useState<Stage>('checking');
    const [lines, setLines] = useState<string[]>([]);
    const [preview, setPreview] = useState<string>();
    const [problem, setProblem] = useState<string>();
    const logRef = useRef<HTMLPreElement>(null);

    const say = (line: string) =>
        setLines((prev) => {
            const next = [...prev, line];
            return next.length > 400 ? next.slice(-400) : next;
        });

    useEffect(() => {
        let container: { teardown: () => void } | undefined;
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
                        if (line.trim()) say(line);
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
                container = wc;
                if (cancelled) return;

                setStage('mounting');
                const response = await fetch(`/api/files?id=${encodeURIComponent(id)}`);
                const payload = (await response.json()) as RunResponse;
                if (!response.ok) {
                    throw new Error(payload.error ?? 'The project could not be loaded.');
                }
                if (!payload.run) {
                    throw new Error('This project has no dev, start, serve or preview script in its package.json, so there is nothing to run.');
                }
                await wc.mount(payload.files as never);
                if (payload.skipped) say(`(${payload.skipped} very large files were left out)`);
                say(`$ npm run ${payload.run.script}   # ${payload.run.command}`);

                wc.on('server-ready', (port, url) => {
                    // Tooling opens ports too — LiveReload on 35729, for one — and
                    // the first port to open is not always the app. Skip the
                    // known helpers and always show the newest server.
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
                const dev = await wc.spawn('npm', ['run', payload.run.script]);
                void pipe(dev);
            } catch (error) {
                if (cancelled) return;
                setProblem(error instanceof Error ? error.message : String(error));
                setStage('failed');
            }
        })();

        return () => {
            cancelled = true;
            container?.teardown();
        };
    }, [id]);

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
                    {problem ? <span className="text-warn">{problem}\n</span> : null}
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
