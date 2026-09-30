'use client';

import { useEffect } from 'react';

/**
 * Every section arrives in 3D, and each one differently: tilting up from the
 * floor, swinging in like a door, flying out of the distance, turning over
 * like a card. The motion is tied to the scroll position itself, not played
 * once — scroll back up and it runs backwards, so the page feels like a space
 * you move through rather than slides that appear.
 *
 * Nothing is hidden before this runs: transforms are applied by the script
 * alone, so crawlers, scripts-off readers and the first paint see the finished
 * page. Reduced motion gets the page with no movement at all.
 */

type Variant = 'tilt' | 'swing' | 'depth' | 'flip' | 'rise';
const ORDER: Variant[] = ['tilt', 'swing', 'depth', 'flip', 'rise', 'swing', 'depth', 'tilt'];

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

function transformFor(variant: Variant, t: number, index: number): string {
    const u = 1 - ease(t); // 1 = not arrived … 0 = in place
    const side = index % 2 === 0 ? 1 : -1;
    switch (variant) {
        case 'tilt':
            return `perspective(1400px) translate3d(0, ${u * 120}px, ${-u * 300}px) rotateX(${u * 38}deg)`;
        case 'swing':
            return `perspective(1400px) translate3d(${side * u * 160}px, ${u * 40}px, ${-u * 200}px) rotateY(${side * -u * 32}deg)`;
        case 'depth':
            return `perspective(1400px) translate3d(0, ${u * 60}px, ${-u * 900}px)`;
        case 'flip':
            return `perspective(1400px) translate3d(0, ${u * 80}px, ${-u * 150}px) rotateX(${-u * 70}deg)`;
        default:
            return `perspective(1400px) translate3d(0, ${u * 160}px, ${-u * 120}px) rotateZ(${side * u * 3}deg)`;
    }
}

export function Reveal() {
    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
        if (!sections.length) return;

        const items = sections.map((el, i) => {
            el.style.transformOrigin = i % 2 === 0 ? '50% 100%' : '50% 50%';
            el.style.willChange = 'transform, opacity';
            return { el, variant: ORDER[i % ORDER.length]!, index: i };
        });

        let frame = 0;
        const update = () => {
            frame = 0;
            const vh = window.innerHeight;
            for (const { el, variant, index } of items) {
                const top = el.getBoundingClientRect().top;
                // 0 when the section's top reaches the bottom of the screen,
                // 1 once it is 35% of the way up.
                const t = Math.min(1, Math.max(0, (vh - top) / (vh * 0.65)));
                el.style.transform = t >= 1 ? '' : transformFor(variant, t, index);
                el.style.opacity = String(0.08 + 0.92 * ease(t));
            }
        };
        const onScroll = () => {
            if (!frame) frame = requestAnimationFrame(update);
        };

        update();
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', onScroll);
            for (const { el } of items) {
                el.style.transform = '';
                el.style.opacity = '';
                el.style.willChange = '';
            }
        };
    }, []);
    return null;
}
