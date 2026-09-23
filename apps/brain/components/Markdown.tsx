'use client';

/**
 * A small Markdown renderer for model answers. It builds React elements and
 * never injects HTML, so neither the model nor repository text quoted by it can
 * put markup or script on the page. File references become buttons that open
 * the code viewer — but only for paths that exist in the repository.
 */
import { Fragment, type ReactNode } from 'react';

type Open = (path: string, lines?: { start: number; end: number }) => void;

/** Same characters as the server's citation check: Next.js "(group)" and "[slug]" segments included. */
const PATH_REF = /^((?:[\w.@()[\]+$~-]+\/)*[\w.()[\]+$~-]+\.[A-Za-z0-9]+)(?::(\d+)(?:-(\d+))?)?$/;

function inline(text: string, known: Set<string>, open: Open, keyBase: string): ReactNode[] {
    const out: ReactNode[] = [];
    const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
    let last = 0;
    let index = 0;
    for (const match of text.matchAll(pattern)) {
        const start = match.index ?? 0;
        if (start > last) out.push(text.slice(last, start));
        const token = match[0];
        const key = `${keyBase}-${index++}`;
        if (token.startsWith('`')) {
            const code = token.slice(1, -1);
            const ref = PATH_REF.exec(code);
            const path = ref?.[1];
            if (path && known.has(path)) {
                const lines = ref[2] ? { start: Number(ref[2]), end: Number(ref[3] ?? ref[2]) } : undefined;
                out.push(
                    <button key={key} type="button" onClick={() => open(path, lines)} className="max-w-full rounded bg-mark px-1 py-px text-left font-mono text-[0.85em] text-accent wrap-anywhere hover:underline">
                        {code}
                    </button>,
                );
            } else {
                out.push(
                    <code key={key} className="rounded bg-panel-2 px-1 py-px font-mono text-[0.85em] wrap-anywhere">
                        {code}
                    </code>,
                );
            }
        } else {
            out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
        }
        last = start + token.length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
}

export function Markdown({ text, known, onOpen }: { text: string; known: Set<string>; onOpen: Open }) {
    const blocks: ReactNode[] = [];
    const lines = text.split('\n');
    let i = 0;
    let key = 0;

    while (i < lines.length) {
        const line = lines[i] ?? '';
        if (line.startsWith('```')) {
            const body: string[] = [];
            i++;
            while (i < lines.length && !(lines[i] ?? '').startsWith('```')) body.push(lines[i++] ?? '');
            i++;
            blocks.push(
                <pre key={key++} className="scroll-thin my-3 overflow-x-auto rounded-md border border-line bg-code p-3 font-mono text-[12.5px] leading-relaxed">
                    {body.join('\n')}
                </pre>,
            );
            continue;
        }
        const heading = /^(#{1,4})\s+(.*)$/.exec(line);
        if (heading) {
            blocks.push(
                <p key={key++} className="mb-1.5 mt-4 text-[13px] font-semibold uppercase tracking-wide text-muted first:mt-0">
                    {inline(heading[2] ?? '', known, onOpen, `h${key}`)}
                </p>,
            );
            i++;
            continue;
        }
        if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
            const ordered = /^\s*\d+\./.test(line);
            const items: string[] = [];
            while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i] ?? '')) {
                items.push((lines[i] ?? '').replace(/^\s*([-*]|\d+\.)\s+/, ''));
                i++;
            }
            const List = ordered ? 'ol' : 'ul';
            blocks.push(
                <List key={key++} className={`my-2 space-y-1 pl-5 ${ordered ? 'list-decimal' : 'list-disc'} marker:text-faint`}>
                    {items.map((item, n) => (
                        <li key={n}>{inline(item, known, onOpen, `l${key}-${n}`)}</li>
                    ))}
                </List>,
            );
            continue;
        }
        if (!line.trim()) {
            i++;
            continue;
        }
        const paragraph: string[] = [];
        while (i < lines.length && (lines[i] ?? '').trim() && !/^(```|#{1,4}\s|\s*([-*]|\d+\.)\s)/.test(lines[i] ?? '')) paragraph.push(lines[i++] ?? '');
        blocks.push(
            <p key={key++} className="my-2 leading-relaxed">
                {paragraph.map((part, n) => (
                    <Fragment key={n}>
                        {n > 0 && ' '}
                        {inline(part, known, onOpen, `p${key}-${n}`)}
                    </Fragment>
                ))}
            </p>,
        );
    }
    return <div className="text-[14px] text-fg">{blocks}</div>;
}
