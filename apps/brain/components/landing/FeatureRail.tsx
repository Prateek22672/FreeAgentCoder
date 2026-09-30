'use client';

import { useEffect, useRef } from 'react';

/**
 * A row of cards that you scroll through sideways, after jesperlandberg.com:
 * the section pins, scrolling down moves the row across, cards bend with the
 * speed of the movement, the one in the middle comes forward and the rest
 * recede, and the row can be dragged. Small uppercase labels sit in the
 * corners. Plain HTML and transforms, so the text stays real, readable and
 * indexable. With reduced motion it is an ordinary sideways-scrolling row.
 */

export interface RailCard {
    href: string;
    kicker: string;
    title: string;
    body: string;
    /** Width relative to height, so cards vary like the reference. */
    ratio: number;
    art: string;
}

export function FeatureRail({ cards }: { cards: RailCard[] }) {
    const section = useRef<HTMLElement>(null);
    const track = useRef<HTMLDivElement>(null);
    const counter = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        const host = section.current;
        const row = track.current;
        if (!host || !row) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            host.dataset.still = 'on';
            return;
        }
        const items = Array.from(row.children) as HTMLElement[];
        let current = 0;
        let target = 0;
        let velocity = 0;
        let frame = 0;
        let running = true;

        const measure = () => {
            const rect = host.getBoundingClientRect();
            const travel = Math.max(0, row.scrollWidth - window.innerWidth);
            const pinned = Math.max(1, rect.height - window.innerHeight);
            const progress = Math.min(1, Math.max(0, -rect.top / pinned));
            target = progress * travel;
        };

        const draw = () => {
            if (!running) return;
            measure();
            const previous = current;
            current += (target - current) * 0.12;
            velocity += (current - previous - velocity) * 0.2;
            row.style.transform = `translate3d(${-current}px, 0, 0)`;
            const bend = Math.max(-22, Math.min(22, velocity * 0.9));
            const middle = window.innerWidth / 2;
            let nearest = 0;
            let nearestDistance = Infinity;
            items.forEach((card, i) => {
                const rect = card.getBoundingClientRect();
                const offset = (rect.left + rect.width / 2 - middle) / middle; // -1 … 1 across the screen
                const distance = Math.min(1, Math.abs(offset));
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearest = i;
                }
                card.style.transform = `perspective(1400px) rotateY(${-bend * 0.6 + offset * -8}deg) skewX(${-bend * 0.25}deg) scale(${1 - distance * 0.12})`;
                card.style.opacity = String(1 - distance * 0.45);
            });
            if (counter.current) counter.current.textContent = `${String(nearest + 1).padStart(2, '0')} / ${String(items.length).padStart(2, '0')}`;
            frame = requestAnimationFrame(draw);
        };

        // Dragging the row scrolls the page, so both ways of moving agree.
        let dragging = false;
        let lastX = 0;
        const travelPerPixel = () => {
            const travel = Math.max(1, row.scrollWidth - window.innerWidth);
            return (host.offsetHeight - window.innerHeight) / travel;
        };
        const down = (e: PointerEvent) => {
            dragging = true;
            lastX = e.clientX;
            host.classList.add('grabbing');
        };
        const move = (e: PointerEvent) => {
            if (!dragging) return;
            window.scrollBy(0, -(e.clientX - lastX) * travelPerPixel());
            lastX = e.clientX;
        };
        const up = () => {
            dragging = false;
            host.classList.remove('grabbing');
        };
        const visibility = () => {
            running = !document.hidden;
            if (running) frame = requestAnimationFrame(draw);
            else cancelAnimationFrame(frame);
        };

        frame = requestAnimationFrame(draw);
        row.addEventListener('pointerdown', down);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        document.addEventListener('visibilitychange', visibility);
        return () => {
            running = false;
            cancelAnimationFrame(frame);
            row.removeEventListener('pointerdown', down);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            document.removeEventListener('visibilitychange', visibility);
        };
    }, []);

    return (
        <section ref={section} className="feature-rail relative" style={{ height: `${Math.max(260, cards.length * 70)}vh` }} aria-label="What you can do">
            <div className="sticky top-0 flex h-dvh flex-col justify-center overflow-hidden">
                <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between px-6 pt-24 text-[11px] font-medium uppercase tracking-[0.14em] text-faint sm:px-10">
                    <span>Free Agent Coder — what it does</span>
                    <span ref={counter}>01 / {String(cards.length).padStart(2, '0')}</span>
                </div>
                <div ref={track} className="rail-track flex items-center gap-5 px-[30vw] will-change-transform sm:gap-8">
                    {cards.map((card) => (
                        <a
                            key={card.title}
                            href={card.href}
                            draggable={false}
                            className="rail-card group relative flex shrink-0 flex-col justify-end overflow-hidden rounded-[20px] p-6 will-change-transform sm:p-8"
                            style={{ height: 'min(42vh, 400px)', aspectRatio: String(card.ratio), background: card.art }}
                        >
                            <span className="absolute left-6 top-6 text-[11px] font-medium uppercase tracking-[0.14em] text-white/70 sm:left-8 sm:top-8">{card.kicker}</span>
                            <span className="max-w-[18ch] font-display text-2xl font-semibold leading-[1.05] tracking-tight text-white sm:text-3xl">{card.title}</span>
                            <span className="mt-3 max-w-[38ch] text-[14px] leading-relaxed text-white/75">{card.body}</span>
                            <span className="mt-5 inline-flex w-fit items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[12px] font-medium text-white backdrop-blur transition-colors group-hover:bg-white group-hover:text-black">
                                Open →
                            </span>
                        </a>
                    ))}
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between px-6 pb-8 text-[11px] font-medium uppercase tracking-[0.14em] text-faint sm:px-10">
                    <span>Scroll or drag</span>
                    <span>Free · Open source · Your keys</span>
                </div>
            </div>
        </section>
    );
}
