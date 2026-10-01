'use client';

import { useEffect, useRef } from 'react';
import { AgentDemo } from './AgentDemo';

/**
 * As the page scrolls from the hero to the carousel, the hero's panel glides
 * down and becomes the carousel's front card, as in the reference.
 *
 * A fixed copy of the panel is drawn between the two places: at the hero's
 * panel while the hero is in view, at the carousel's front card once the
 * carousel is pinned, and in between as you scroll. The real ones are hidden
 * while the copy is in flight, so only one panel is ever seen. Wide screens
 * only; with reduced motion nothing moves.
 */
export function PanelFlight() {
    const flyer = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = flyer.current;
        if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        let frame = 0;
        let shown = false;

        const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const tick = () => {
            frame = requestAnimationFrame(tick);
            const from = document.querySelector<HTMLElement>('[data-fly="from"]');
            const to = document.querySelector<HTMLElement>('[data-fly="to"]');
            const carousel = to?.closest('section');
            if (!from || !to || !carousel || window.innerWidth < 768) {
                if (shown) hide(from, to);
                return;
            }
            // 0 while the carousel is below the screen, 1 once its top reaches the top.
            const top = carousel.getBoundingClientRect().top;
            const p = Math.min(1, Math.max(0, 1 - top / window.innerHeight));
            if (p <= 0 || p >= 1) {
                if (shown) hide(from, to);
                return;
            }
            const a = from.getBoundingClientRect();
            // Where the front card sits right now: centred on the ring's anchor, which moves up with the section.
            const ring = to.parentElement!.getBoundingClientRect();
            const w = to.offsetWidth;
            const h = to.offsetHeight;
            const bx = ring.left - w / 2;
            const targetY = ring.top - h / 2;
            const t = ease(p);
            const x = a.left + (bx - a.left) * t;
            const y = a.top + (targetY - a.top) * t;
            const scale = (a.width + (w - a.width) * t) / a.width;
            el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale}) rotate(${(1 - t) * -2}deg)`;
            el.style.width = `${a.width}px`;
            if (!shown) {
                shown = true;
                el.style.visibility = 'visible';
                from.dataset.flying = '';
                to.dataset.flying = '';
            }
        };
        const hide = (from: HTMLElement | null, to: HTMLElement | null) => {
            shown = false;
            el.style.visibility = 'hidden';
            if (from) delete from.dataset.flying;
            if (to) delete to.dataset.flying;
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, []);

    return (
        <div ref={flyer} className="pointer-events-none fixed left-0 top-0 z-40 origin-top-left" style={{ visibility: 'hidden' }} aria-hidden>
            <AgentDemo width="w-full" frozen />
        </div>
    );
}
