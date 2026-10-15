'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { Health, SystemEdge, SystemNode } from '@/lib/system';

/**
 * The live workflow: FreeAgentCoder's pipeline drawn like an automation
 * canvas. Each node shows its health; lines carry the flow from request to
 * result and the dashed ones are the learning loops. Click a node for its
 * numbers, recent problems, and how it works. Refreshes every minute.
 */

const COL = 300;
const ROW = 118;
const W = 236;
const H = 96;
const PAD_X = 28;
const PAD_Y = 64;

const COLORS: Record<Health, string> = { ok: '#3fb950', warn: '#d29922', down: '#f85149', idle: '#6e7681' };
const LABEL: Record<Health, string> = { ok: 'Healthy', warn: 'Needs attention', down: 'Down', idle: 'No data yet' };

function Glyph({ name }: { name: string }) {
    const p: Record<string, string> = {
        editor: 'M4 5h16v11H4z M9 20h6 M12 16v4',
        route: 'M5 6h6a4 4 0 0 1 0 8H8 M8 14l-3 3 3 3 M19 4v16',
        router: 'M4 12h4 M16 12h4 M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M12 4v4 M12 16v4',
        model: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 12l8-4.5 M12 12v9 M12 12L4 7.5',
        pool: 'M4 7h16v4H4z M4 13h16v4H4z M8 9h.01 M8 15h.01',
        tools: 'M14 6l4 4-8 8H6v-4z M12 8l4 4',
        check: 'M5 12l4 4 10-10',
        outcome: 'M5 19V9 M12 19V5 M19 19v-7',
        learn: 'M12 4a6 6 0 0 0-3 11v3h6v-3a6 6 0 0 0-3-11z M10 21h4',
        lab: 'M9 3h6 M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3',
    };
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={p[name] ?? p.model} />
        </svg>
    );
}

export function SystemFlow({ nodes, edges, groups, updatedAt }: { nodes: SystemNode[]; edges: SystemEdge[]; groups: { title: string; note: string }[]; updatedAt: number }) {
    const router = useRouter();
    const [selected, setSelected] = useState<string | undefined>();
    // Shown in the viewer's own time zone, so only after the page is in the browser.
    const [updated, setUpdated] = useState('');
    useEffect(() => setUpdated(new Date(updatedAt).toLocaleTimeString()), [updatedAt]);
    useEffect(() => {
        const timer = setInterval(() => router.refresh(), 60_000);
        return () => clearInterval(timer);
    }, [router]);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(undefined);
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const rowsPerGroup = groups.map((_, g) => Math.max(1, ...nodes.filter((x) => x.group === g).map((x) => x.row + 1)));
    const tallest = Math.max(...rowsPerGroup);
    // Groups with fewer nodes are centred vertically against the tallest column.
    const place = useMemo(() => {
        const at = new Map<string, { x: number; y: number }>();
        for (const node of nodes) {
            const offset = ((tallest - rowsPerGroup[node.group]!) * ROW) / 2;
            at.set(node.id, { x: PAD_X + node.group * COL, y: PAD_Y + offset + node.row * ROW });
        }
        return at;
    }, [nodes, rowsPerGroup, tallest]);
    const width = PAD_X * 2 + (groups.length - 1) * COL + W;
    const height = PAD_Y + tallest * ROW + 24;
    const byId = new Map(nodes.map((x) => [x.id, x]));
    const current = selected ? byId.get(selected) : undefined;

    return (
        <div className="relative">
            <div className="mb-2 flex items-center gap-4 text-[12px] text-muted">
                {(['ok', 'warn', 'down', 'idle'] as Health[]).map((h) => (
                    <span key={h} className="inline-flex items-center gap-1.5">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS[h] }} />
                        {LABEL[h]}
                    </span>
                ))}
                <span className="ml-auto text-faint">Live{updated ? ` · updated ${updated}` : ''} · refreshes every minute</span>
            </div>
            <div className="overflow-x-auto rounded-xl border border-line" style={{ backgroundImage: 'radial-gradient(circle, rgba(128,128,128,0.18) 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
                <div className="relative" style={{ width, height }}>
                    {groups.map((g, i) => {
                        const ys = nodes.filter((x) => x.group === i).map((x) => place.get(x.id)!.y);
                        const top = Math.min(...ys) - 44;
                        const bottom = Math.max(...ys) + H + 14;
                        return (
                            <div key={g.title} className="absolute rounded-lg border border-line/70 bg-panel/40" style={{ left: PAD_X + i * COL - 12, top, width: W + 24, height: bottom - top }}>
                                <div className="px-3 pt-2 text-[13px] font-semibold text-fg">{g.title}</div>
                                <div className="px-3 text-[11px] text-faint">{g.note}</div>
                            </div>
                        );
                    })}
                    <svg className="pointer-events-none absolute inset-0" width={width} height={height}>
                        <defs>
                            <style>{`@keyframes fac-flow { to { stroke-dashoffset: -24; } } .fac-flow { animation: fac-flow 1.2s linear infinite; } @media (prefers-reduced-motion: reduce) { .fac-flow { animation: none; } }`}</style>
                        </defs>
                        {edges.map((e) => {
                            const a = place.get(e.from);
                            const b = place.get(e.to);
                            const target = byId.get(e.to);
                            if (!a || !b || !target) return null;
                            const color = COLORS[target.health];
                            const from = byId.get(e.from);
                            if (from && from.group === target.group) {
                                // Two steps in one column: a short line between them.
                                const top = a.y < b.y ? a : b;
                                const bottom = a.y < b.y ? b : a;
                                return <path key={`${e.from}-${e.to}`} d={`M${top.x + W / 2},${top.y + H} L${bottom.x + W / 2},${bottom.y}`} fill="none" stroke={color} strokeOpacity="0.55" strokeWidth="1.5" strokeDasharray="5 6" />;
                            }
                            if (e.loop) {
                                // A loop back to an earlier stage, drawn under the canvas.
                                const x1 = a.x + W / 2;
                                const y1 = a.y + H;
                                const x2 = b.x + W / 2;
                                const y2 = b.y + H;
                                const dip = height - 10;
                                return <path key={`${e.from}-${e.to}`} d={`M${x1},${y1} C${x1},${dip} ${x2},${dip} ${x2},${y2}`} fill="none" stroke={color} strokeOpacity="0.55" strokeWidth="1.5" strokeDasharray="5 6" />;
                            }
                            const x1 = a.x + W;
                            const y1 = a.y + H / 2;
                            const x2 = b.x;
                            const y2 = b.y + H / 2;
                            const mid = (x1 + x2) / 2;
                            const d = `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
                            return (
                                <g key={`${e.from}-${e.to}`}>
                                    <path d={d} fill="none" stroke="rgba(128,128,128,0.35)" strokeWidth="2" />
                                    {target.health !== 'idle' ? <path d={d} fill="none" stroke={color} strokeWidth="2" strokeDasharray="4 8" className="fac-flow" /> : null}
                                </g>
                            );
                        })}
                    </svg>
                    {nodes.map((node) => {
                        const at = place.get(node.id)!;
                        const color = COLORS[node.health];
                        return (
                            <button
                                key={node.id}
                                type="button"
                                onClick={() => setSelected(node.id === selected ? undefined : node.id)}
                                aria-pressed={node.id === selected}
                                aria-label={`${node.title}: ${LABEL[node.health]}. ${node.metric}`}
                                className={`absolute flex flex-col gap-1 rounded-lg border bg-bg p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${node.id === selected ? 'border-accent' : 'border-line'}`}
                                style={{ left: at.x, top: at.y, width: W, height: H }}
                            >
                                <span className="flex items-center gap-2">
                                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md" style={{ color, background: `${color}22`, boxShadow: `inset 0 0 0 1.5px ${color}` }}>
                                        <Glyph name={node.icon} />
                                    </span>
                                    <span className="min-w-0">
                                        <span className="block truncate text-[13px] font-semibold text-fg">{node.title}</span>
                                        <span className="block truncate text-[11px] text-faint">{node.subtitle}</span>
                                    </span>
                                </span>
                                <span className="mt-auto flex items-center gap-1.5 text-[12px] text-muted">
                                    <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                                    <span className="truncate">{node.metric}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {current ? (
                <aside role="dialog" aria-label={current.title} className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-line bg-bg p-5 shadow-2xl">
                    <div className="flex items-start gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ color: COLORS[current.health], background: `${COLORS[current.health]}22` }}>
                            <Glyph name={current.icon} />
                        </span>
                        <div className="min-w-0 flex-1">
                            <h3 className="text-[16px] font-semibold text-fg">{current.title}</h3>
                            <p className="text-[12px]" style={{ color: COLORS[current.health] }}>
                                {LABEL[current.health]} · {current.metric}
                            </p>
                        </div>
                        <button type="button" onClick={() => setSelected(undefined)} className="rounded-md border border-line px-2 py-1 text-[12px] text-muted hover:text-fg">
                            Close
                        </button>
                    </div>
                    <dl className="mt-4 grid gap-1.5 text-[13px]">
                        {current.details.map((d) => (
                            <div key={d.label} className="flex justify-between gap-3 border-b border-line/60 pb-1.5">
                                <dt className="text-muted">{d.label}</dt>
                                <dd className="text-right text-fg tabular-nums">{d.value}</dd>
                            </div>
                        ))}
                    </dl>
                    <Block title="Problems and recent events" items={current.issues} empty="Nothing wrong recorded." tone="bad" />
                    <h4 className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-muted">How it works</h4>
                    <p className="mt-1 text-[13px] leading-relaxed text-fg">{current.how}</p>
                    <Block title="Strengths" items={current.strengths} tone="ok" />
                    <Block title="Weaknesses" items={current.weaknesses} tone="warn" />
                    <Block title="Next improvements" items={current.next} />
                </aside>
            ) : null}
        </div>
    );
}

function Block({ title, items, empty, tone }: { title: string; items: string[]; empty?: string; tone?: 'ok' | 'warn' | 'bad' }) {
    const dot = tone === 'ok' ? 'bg-ok' : tone === 'bad' ? 'bg-bad' : tone === 'warn' ? 'bg-[#d29922]' : 'bg-accent';
    return (
        <>
            <h4 className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h4>
            {items.length ? (
                <ul className="mt-1.5 grid gap-1.5 text-[13px] text-fg">
                    {items.map((item) => (
                        <li key={item} className="flex gap-2">
                            <span className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                            <span className="break-words">{item}</span>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="mt-1 text-[13px] text-faint">{empty ?? '—'}</p>
            )}
        </>
    );
}
