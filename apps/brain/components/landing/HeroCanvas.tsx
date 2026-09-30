'use client';

import { useEffect, useRef } from 'react';

/**
 * A 3D globe of connected points behind the hero. It turns slowly on its own,
 * tilts toward the cursor, and flies toward the viewer as the page scrolls —
 * the hero dissolves into it on the way down.
 *
 * Real perspective projection on a plain canvas, no library: points nearer the
 * camera are larger and brighter, links fade with depth. Stops when the tab is
 * hidden; holds still for anyone who asked for reduced motion.
 */
export function HeroCanvas() {
    const ref = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = ref.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return;
        const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        const COUNT = 240;
        // Evenly spread points on a sphere (Fibonacci lattice).
        const base = Array.from({ length: COUNT }, (_, i) => {
            const y = 1 - (i / (COUNT - 1)) * 2;
            const r = Math.sqrt(1 - y * y);
            const theta = i * Math.PI * (3 - Math.sqrt(5));
            return { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r };
        });
        // Precomputed neighbours, so each frame only draws near links.
        const links: [number, number][] = [];
        for (let i = 0; i < COUNT; i += 1) {
            for (let j = i + 1; j < COUNT; j += 1) {
                const a = base[i]!;
                const b = base[j]!;
                if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.26) links.push([i, j]);
            }
        }

        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#d97757';
        let width = 0;
        let height = 0;
        let frame = 0;
        let running = true;
        const target = { x: 0, y: 0 };
        const tilt = { x: 0, y: 0 };

        const resize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            width = canvas.clientWidth;
            height = canvas.clientHeight;
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
        };

        const draw = (time: number) => {
            if (!running) return;
            context.clearRect(0, 0, width, height);
            const scroll = Math.min(1, window.scrollY / Math.max(1, height));
            tilt.x += (target.x - tilt.x) * 0.05;
            tilt.y += (target.y - tilt.y) * 0.05;

            const spin = (still ? 0 : time * 0.00012) + tilt.x * 0.9 + scroll * 2.2;
            const pitch = -0.35 + tilt.y * 0.6 + scroll * 0.6;
            const cy = Math.cos(spin);
            const sy = Math.sin(spin);
            const cx = Math.cos(pitch);
            const sx = Math.sin(pitch);

            // Scrolling flies the camera into the globe.
            const radius = Math.min(width, height) * (0.42 + scroll * 0.9);
            const camera = 3.2 - scroll * 1.6;
            const centerX = width * 0.5 + tilt.x * 30;
            const centerY = height * 0.46 + tilt.y * 20 - scroll * height * 0.15;

            const projected = base.map((p) => {
                const x1 = p.x * cy - p.z * sy;
                const z1 = p.x * sy + p.z * cy;
                const y2 = p.y * cx - z1 * sx;
                const z2 = p.y * sx + z1 * cx;
                const depth = camera / (camera + z2);
                return { x: centerX + x1 * radius * depth, y: centerY + y2 * radius * depth, z: z2, depth };
            });

            const fade = 1 - scroll * 0.85;
            context.strokeStyle = accent;
            context.lineWidth = 1;
            for (const [i, j] of links) {
                const a = projected[i]!;
                const b = projected[j]!;
                const near = (2 - (a.z + b.z)) / 4; // 0 far … 1 near
                context.globalAlpha = Math.max(0, near * 0.45 * fade);
                context.beginPath();
                context.moveTo(a.x, a.y);
                context.lineTo(b.x, b.y);
                context.stroke();
            }
            context.fillStyle = accent;
            for (const p of projected) {
                const near = (1 - p.z) / 2;
                context.globalAlpha = Math.max(0, (0.25 + near * 0.75) * fade);
                context.beginPath();
                context.arc(p.x, p.y, 0.6 + near * 2.2 * p.depth, 0, Math.PI * 2);
                context.fill();
            }
            context.globalAlpha = 1;
            if (!still) frame = requestAnimationFrame(draw);
        };

        const onMove = (event: PointerEvent) => {
            target.x = event.clientX / window.innerWidth - 0.5;
            target.y = event.clientY / window.innerHeight - 0.5;
        };
        const onVisibility = () => {
            running = !document.hidden;
            if (running && !still) frame = requestAnimationFrame(draw);
            else cancelAnimationFrame(frame);
        };
        const onScroll = () => {
            if (still) draw(0);
        };

        resize();
        frame = requestAnimationFrame(draw);
        window.addEventListener('resize', resize);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('scroll', onScroll, { passive: true });
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            running = false;
            cancelAnimationFrame(frame);
            window.removeEventListener('resize', resize);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('scroll', onScroll);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, []);

    return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}
