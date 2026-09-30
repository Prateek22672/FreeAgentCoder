'use client';

import { useRef } from 'react';
import { Arrow } from './Hero';
import { useScrollProgress } from './progress';

export interface WorkCard {
    href: string;
    slug: string;
    title: string;
    tags: string;
    tag: string;
    /** Background art: a soft glowing shape on near-black. */
    art: string;
    accent: string;
    wide?: boolean;
}

/**
 * A pinned row that scrolls sideways as you scroll down. The card nearest the
 * middle is full size; the rest shrink back and dim a little.
 */
export function WorkRail({ cards, archive }: { cards: WorkCard[]; archive: { href: string; title: string; action: string } }) {
    const host = useRef<HTMLElement>(null);
    const track = useRef<HTMLDivElement>(null);

    useScrollProgress(
        host,
        (p) => {
            const row = track.current;
            if (!row) return;
            const travel = Math.max(0, row.scrollWidth - window.innerWidth);
            row.style.transform = `translate3d(${-p * travel}px, 0, 0)`;
            const middle = window.innerWidth / 2;
            (Array.from(row.children) as HTMLElement[]).forEach((card) => {
                const rect = card.getBoundingClientRect();
                const d = Math.min(1, Math.abs(rect.left + rect.width / 2 - middle) / middle);
                const inner = card.firstElementChild as HTMLElement | null;
                if (inner) {
                    inner.style.transform = `scale(${1 - d * 0.2})`;
                    inner.style.opacity = String(1 - d * 0.35);
                }
            });
        },
        0,
    );
    const total = String(cards.length + 1).padStart(2, '0');

    return (
        <section ref={host} id="work" className="cine-rail relative h-[340vh] bg-[#070708] text-white" aria-labelledby="work-title">
            <div className="sticky top-0 flex h-dvh flex-col justify-center overflow-hidden">
                <h2 id="work-title" className="absolute left-[5vw] top-[15vh] font-mono text-[11px] uppercase tracking-[0.22em] text-white/50">
                    What you can do
                </h2>
                <div ref={track} className="flex w-max items-center gap-6 px-[5vw] will-change-transform">
                    {cards.map((card, i) => (
                        <div key={card.title} className="shrink-0">
                            <a
                                href={card.href}
                                className={`group relative flex aspect-[1.3] flex-col overflow-hidden rounded-[20px] border border-white/10 bg-[#0c0c0e] p-4 transition-colors hover:border-white/25 ${
                                    card.wide ? 'w-[clamp(290px,48vw,600px)]' : 'w-[clamp(270px,40vw,500px)]'
                                }`}
                            >
                                <span className="pointer-events-none absolute inset-0" style={{ background: card.art }} aria-hidden />
                                <span className="relative flex items-center justify-between font-mono text-[11px] text-white/60">
                                    <span className="flex items-center gap-2.5">
                                        <span className="rounded-full border border-white/15 px-2 py-0.5 text-white/80">{String(i + 1).padStart(2, '0')}</span>
                                        <span className="font-sans text-[12.5px] text-white/85">{card.slug}</span>
                                    </span>
                                    <span className="uppercase tracking-[0.14em]">{card.tag}</span>
                                </span>
                                <span className="relative mt-auto flex items-end justify-between gap-4">
                                    <span>
                                        <span className="cine-display block text-[clamp(1.6rem,3.2vw,2.5rem)] font-medium leading-none tracking-[-0.03em]">{card.title}</span>
                                        <span className="mt-2 block text-[12px] text-white/55">{card.tags}</span>
                                    </span>
                                    <span
                                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/12 bg-black/40 px-3.5 py-2 text-[12.5px] backdrop-blur transition-colors group-hover:bg-white group-hover:text-zinc-950"
                                        style={{ color: card.accent }}
                                    >
                                        Open <Arrow size={12} />
                                    </span>
                                </span>
                            </a>
                        </div>
                    ))}
                    <div className="shrink-0">
                        <a
                            href={archive.href}
                            className="flex aspect-[1.3] w-[clamp(240px,30vw,380px)] flex-col items-center justify-center rounded-[20px] border border-white/10 bg-[#151517] p-6 text-center transition-colors hover:border-white/25"
                        >
                            <span className="font-mono text-[11px] tracking-[0.2em] text-white/45">
                                {total} / {total}
                            </span>
                            <span className="cine-display mt-3 text-[clamp(1.7rem,3.2vw,2.6rem)] font-medium leading-[1.02] tracking-[-0.03em]">{archive.title}</span>
                            <span className="mt-6 inline-flex items-center gap-2 rounded-[12px] border border-white/10 bg-white/10 px-5 py-3 text-[14px]">
                                {archive.action} <Arrow size={13} />
                            </span>
                        </a>
                    </div>
                </div>
            </div>
        </section>
    );
}
