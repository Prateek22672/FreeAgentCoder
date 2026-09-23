'use client';

import { roleOf } from '@agentic/project-brain';
import { useEffect, useMemo, useRef, useState } from 'react';
import { highlight } from '@/lib/highlight';
import { Icon } from '../icons';
import { RoleBadge, Spinner } from '../ui';

/** A read-only editor: line numbers, syntax colours, and the cited range highlighted. */
export function CodeEditor({
    brainId,
    path,
    lines,
    onImpact,
    onAsk,
}: {
    brainId: string;
    path: string;
    lines?: { start: number; end: number };
    onImpact: (path: string) => void;
    onAsk: (question: string) => void;
}) {
    const [file, setFile] = useState<{ text?: string; url?: string; bytes?: number; error?: string }>({});
    const marked = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let live = true;
        setFile({});
        fetch(`/api/file?id=${encodeURIComponent(brainId)}&path=${encodeURIComponent(path)}`)
            .then((r) => r.json())
            .then((data: { text?: string; url?: string; bytes?: number; error?: string }) => live && setFile(data))
            .catch(() => live && setFile({ error: 'Could not load the file.' }));
        return () => {
            live = false;
        };
    }, [brainId, path]);

    const tokens = useMemo(() => (file.text !== undefined ? highlight(file.text, path) : []), [file.text, path]);

    useEffect(() => {
        marked.current?.scrollIntoView({ block: 'center' });
    }, [tokens, lines?.start]);

    const { start = 0, end = 0 } = lines ?? {};
    const crumbs = path.split('/');

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-4 py-1.5 text-[12px]">
                <span className="flex min-w-0 items-center gap-1 text-faint">
                    {crumbs.map((part, i) => (
                        <span key={i} className="flex min-w-0 items-center gap-1">
                            {i > 0 && <Icon name="chevronRight" size={12} />}
                            <span className={i === crumbs.length - 1 ? 'truncate text-fg' : 'truncate'}>{part}</span>
                        </span>
                    ))}
                </span>
                <RoleBadge role={roleOf(path)} />
                {lines && (
                    <span className="font-mono text-faint">
                        lines {start}–{end}
                    </span>
                )}
                <span className="ml-auto flex items-center gap-1">
                    <button type="button" onClick={() => onImpact(path)} className="flex items-center gap-1 rounded px-2 py-1 text-muted hover:bg-panel-2 hover:text-fg" title="Every file that imports this one">
                        <Icon name="dependsOn" size={13} /> What depends on this
                    </button>
                    <button
                        type="button"
                        onClick={() => onAsk(`Explain what ${path} does and how it fits into the project.`)}
                        className="flex items-center gap-1 rounded px-2 py-1 text-muted hover:bg-panel-2 hover:text-fg"
                    >
                        <Icon name="ask" size={13} /> Explain
                    </button>
                    {file.url && (
                        <a href={file.url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1 rounded px-2 py-1 text-muted hover:bg-panel-2 hover:text-fg">
                            <Icon name="external" size={13} /> GitHub
                        </a>
                    )}
                </span>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-auto bg-code">
                {file.text === undefined && !file.error && (
                    <div className="flex items-center gap-2 p-4 text-sm text-muted">
                        <Spinner /> Opening {path}…
                    </div>
                )}
                {file.error && <p className="p-4 text-sm text-bad">{file.error}</p>}
                {file.text !== undefined && (
                    <div className="min-w-max py-2 font-mono text-[12.5px] leading-[1.65]">
                        {tokens.map((line, n) => {
                            const number = n + 1;
                            const hit = number >= start && number <= end;
                            return (
                                <div key={n} ref={number === start ? marked : undefined} className={hit ? 'bg-mark' : undefined}>
                                    <span className={`inline-block w-14 select-none pr-4 text-right ${hit ? 'text-accent' : 'text-faint'}`}>{number}</span>
                                    <span className="whitespace-pre pr-6">
                                        {line.map((token, t) => (token.k === 'plain' ? token.v : <span key={t} className={`tk-${token.k}`}>{token.v}</span>))}
                                        {line.length === 1 && !line[0]?.v ? ' ' : null}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
