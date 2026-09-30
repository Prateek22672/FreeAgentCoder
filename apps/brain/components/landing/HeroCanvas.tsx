'use client';

import { useEffect, useRef } from 'react';

/**
 * A slow field of points in the hero, joined by faint lines when they drift
 * near each other, leaning gently toward the cursor. Drawn on a canvas, with
 * no library, so it costs the page nothing to load. It stops when the tab is
 * hidden, stays still for anyone who asked their system for reduced motion,
 * and sits behind the text at low opacity so it never competes with it.
 */
export function HeroCanvas() {
    const ref = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = ref.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        const points: { x: number; y: number; vx: number; vy: number }[] = [];
        const pointer = { x: -1, y: -1 };
        let width = 0;
        let height = 0;
        let frame = 0;
        let running = true;

        const resize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            width = canvas.clientWidth;
            height = canvas.clientHeight;
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
            const wanted = Math.min(90, Math.round((width * height) / 16_000));
            while (points.length < wanted) {
                points.push({ x: Math.random() * width, y: Math.random() * height, vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25 });
            }
            points.length = wanted;
        };

        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#d97757';

        const draw = () => {
            if (!running) return;
            context.clearRect(0, 0, width, height);
            for (const p of points) {
                // A faint pull toward the cursor, so the field feels alive rather than looping.
                if (pointer.x >= 0) {
                    const dx = pointer.x - p.x;
                    const dy = pointer.y - p.y;
                    const distance = Math.hypot(dx, dy) || 1;
                    if (distance < 220) {
                        p.vx += (dx / distance) * 0.004;
                        p.vy += (dy / distance) * 0.004;
                    }
                }
                p.vx *= 0.995;
                p.vy *= 0.995;
                p.x += p.vx;
                p.y += p.vy;
                if (p.x < 0 || p.x > width) p.vx *= -1;
                if (p.y < 0 || p.y > height) p.vy *= -1;
            }
            context.lineWidth = 1;
            for (let i = 0; i < points.length; i += 1) {
                for (let j = i + 1; j < points.length; j += 1) {
                    const a = points[i]!;
                    const b = points[j]!;
                    const distance = Math.hypot(a.x - b.x, a.y - b.y);
                    if (distance < 130) {
                        context.strokeStyle = accent;
                        context.globalAlpha = (1 - distance / 130) * 0.28;
                        context.beginPath();
                        context.moveTo(a.x, a.y);
                        context.lineTo(b.x, b.y);
                        context.stroke();
                    }
                }
            }
            context.globalAlpha = 0.7;
            context.fillStyle = accent;
            for (const p of points) {
                context.beginPath();
                context.arc(p.x, p.y, 1.4, 0, Math.PI * 2);
                context.fill();
            }
            context.globalAlpha = 1;
            frame = requestAnimationFrame(draw);
        };

        const onMove = (event: PointerEvent) => {
            const rect = canvas.getBoundingClientRect();
            pointer.x = event.clientX - rect.left;
            pointer.y = event.clientY - rect.top;
        };
        const onLeave = () => {
            pointer.x = -1;
            pointer.y = -1;
        };
        const onVisibility = () => {
            running = !document.hidden;
            if (running) frame = requestAnimationFrame(draw);
            else cancelAnimationFrame(frame);
        };

        resize();
        frame = requestAnimationFrame(draw);
        window.addEventListener('resize', resize);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerleave', onLeave);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            running = false;
            cancelAnimationFrame(frame);
            window.removeEventListener('resize', resize);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerleave', onLeave);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, []);

    return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full opacity-60" aria-hidden />;
}
