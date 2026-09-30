'use client';

import { useEffect, type RefObject } from 'react';

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
/** Where t sits between a and b, as 0…1. */
export const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
export const ease = (t: number) => 1 - Math.pow(1 - t, 3);
export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Drives a pinned section from the scroll position. `p` runs 0 → 1 while the
 * section's sticky frame is on screen, and is smoothed so the motion glides
 * rather than stepping with the wheel. Only runs while the section is near the
 * viewport. With reduced motion it draws once, at `still`, and stops.
 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>, draw: (p: number) => void, still = 0.5) {
    useEffect(() => {
        const host = ref.current;
        if (!host) return;
        if (reducedMotion()) {
            host.dataset.still = 'on';
            draw(still);
            return;
        }
        let frame = 0;
        let current = -1;
        let visible = false;

        const target = () => {
            const rect = host.getBoundingClientRect();
            const room = Math.max(1, rect.height - window.innerHeight);
            return clamp(-rect.top / room);
        };
        const tick = () => {
            const goal = target();
            current = current < 0 ? goal : current + (goal - current) * 0.14;
            if (Math.abs(goal - current) < 0.0004) current = goal;
            draw(current);
            frame = visible ? requestAnimationFrame(tick) : 0;
        };
        const seen = new IntersectionObserver(
            ([entry]) => {
                visible = entry.isIntersecting;
                if (visible && !frame) frame = requestAnimationFrame(tick);
            },
            { rootMargin: '200px 0px' },
        );
        seen.observe(host);
        draw(target());
        return () => {
            seen.disconnect();
            cancelAnimationFrame(frame);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
}
