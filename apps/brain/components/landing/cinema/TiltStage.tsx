'use client';

import { useEffect, useRef } from 'react';

/**
 * A card that leans toward the pointer in 3D, with a soft light that follows
 * it; children marked data-depth float that many pixels in front, so the card
 * reads as layers. It eases back flat when the pointer leaves. Mouse and pen
 * only (a touch screen keeps it flat), and nothing moves with reduced motion.
 *
 * Elements marked data-flip inside it flip up one after another the first
 * time the card comes on screen.
 */
export function TiltStage({ children, className = '', max = 7 }: { children: React.ReactNode; className?: string; max?: number }) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        const flips = [...el.querySelectorAll<HTMLElement>('[data-flip]')];
        flips.forEach((item, i) => {
            item.classList.add('flip-wait');
            item.style.transitionDelay = `${i * 110}ms`;
        });
        const seen = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    flips.forEach((item) => item.classList.add('flip-in'));
                    seen.disconnect();
                }
            },
            { threshold: 0.35 },
        );
        seen.observe(el);

        if (!window.matchMedia('(pointer: fine)').matches) return () => seen.disconnect();
        // Eased toward the pointer every frame, so the card glides rather than snaps.
        const goal = { x: 0, y: 0, glow: 0 };
        const now = { x: 0, y: 0, glow: 0 };
        let raf = 0;
        const tick = () => {
            now.x += (goal.x - now.x) * 0.12;
            now.y += (goal.y - now.y) * 0.12;
            now.glow += (goal.glow - now.glow) * 0.12;
            el.style.setProperty('--tilt-x', `${(-now.y * max).toFixed(2)}deg`);
            el.style.setProperty('--tilt-y', `${(now.x * max).toFixed(2)}deg`);
            el.style.setProperty('--glow-x', `${((now.x + 1) * 50).toFixed(1)}%`);
            el.style.setProperty('--glow-y', `${((now.y + 1) * 50).toFixed(1)}%`);
            el.style.setProperty('--glow', now.glow.toFixed(3));
            const moving = Math.abs(goal.x - now.x) + Math.abs(goal.y - now.y) + Math.abs(goal.glow - now.glow) > 0.002;
            raf = moving ? requestAnimationFrame(tick) : 0;
        };
        const wake = () => {
            if (!raf) raf = requestAnimationFrame(tick);
        };
        const move = (event: PointerEvent) => {
            if (event.pointerType === 'touch') return;
            // Lean less while something is being dragged across the card.
            const calm = el.querySelector('[data-dragging]') ? 0.35 : 1;
            const r = el.getBoundingClientRect();
            goal.x = (((event.clientX - r.left) / r.width) * 2 - 1) * calm;
            goal.y = (((event.clientY - r.top) / r.height) * 2 - 1) * calm;
            goal.glow = 1;
            wake();
        };
        const leave = () => {
            goal.x = 0;
            goal.y = 0;
            goal.glow = 0;
            wake();
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerleave', leave);
        return () => {
            seen.disconnect();
            cancelAnimationFrame(raf);
            el.removeEventListener('pointermove', move);
            el.removeEventListener('pointerleave', leave);
        };
    }, [max]);

    return (
        <div className="tilt-scene">
            <div ref={ref} className={`tilt-card ${className}`}>
                <div className="tilt-glare" aria-hidden />
                {children}
            </div>
        </div>
    );
}
