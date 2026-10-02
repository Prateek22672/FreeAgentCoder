'use client';

import { useRef } from 'react';
import { Star } from './Hero';
import { ease, span, useScrollProgress } from './progress';

const STATS = [
    { value: '~3s', label: 'To read a repository' },
    { value: '5', label: 'Free requests a day here' },
    { value: '$0', label: 'Subscription, ever' },
];

/**
 * Two halves of a sentence slide in from opposite corners, a star swells in
 * the middle, then the words step back so the numbers can speak.
 */
export function Beyond() {
    const host = useRef<HTMLElement>(null);
    const top = useRef<HTMLSpanElement>(null);
    const bottom = useRef<HTMLSpanElement>(null);
    const star = useRef<HTMLDivElement>(null);
    const stats = useRef<HTMLDListElement>(null);
    const copy = useRef<HTMLDivElement>(null);

    useScrollProgress(
        host,
        (p) => {
            // The words slide in while the section rises into view, so it never opens on an empty screen.
            const arrive = ease(span(p, -0.5, 0.12));
            const recede = span(p, 0.42, 0.66);
            const detail = ease(span(p, 0.5, 0.78));
            if (top.current) {
                top.current.style.transform = `translate3d(${(1 - arrive) * -30}vw, 0, 0)`;
                top.current.style.opacity = String(arrive * (1 - recede * 0.72));
            }
            if (bottom.current) {
                bottom.current.style.transform = `translate3d(${(1 - arrive) * 30}vw, 0, 0)`;
                bottom.current.style.opacity = String(arrive * (1 - recede * 0.72));
            }
            if (star.current) {
                const grow = ease(span(p, -0.35, 0.45));
                star.current.style.transform = `translate(-50%, -50%) scale(${0.25 + grow * 0.75}) rotate(${(1 - grow) * -45}deg)`;
                star.current.style.opacity = String(Math.min(1, grow * 1.5));
            }
            stats.current?.querySelectorAll<HTMLElement>('[data-stat]').forEach((el, i) => {
                const t = ease(span(p, 0.5 + i * 0.06, 0.72 + i * 0.06));
                el.style.opacity = String(t);
                el.style.transform = `translate3d(${(1 - t) * 40}px, 0, 0)`;
            });
            if (copy.current) {
                copy.current.style.opacity = String(detail);
                copy.current.style.filter = `blur(${(1 - detail) * 8}px)`;
            }
        },
        1,
        { early: true },
    );

    return (
        <section ref={host} className="relative h-[260vh] bg-[#070708] text-white" aria-labelledby="beyond-title">
            <div className="sticky top-0 h-dvh overflow-hidden">
                <h2 id="beyond-title" className="cine-display text-[clamp(3.4rem,11.5vw,11rem)] font-medium leading-[0.9] tracking-[-0.05em]">
                    <span ref={top} className="absolute block left-[3vw] top-[11vh] will-change-transform">
                        Understand
                    </span>
                    <span ref={bottom} className="absolute block bottom-[5vh] right-[3vw] will-change-transform">
                        then build
                    </span>
                </h2>
                <div ref={star} className="absolute left-1/2 top-1/2 will-change-transform" aria-hidden>
                    <div className="cine-star-glow absolute left-1/2 top-1/2 size-[46vmin] -translate-x-1/2 -translate-y-1/2 rounded-full" />
                    <Star size={180} className="relative size-[28vmin] text-white drop-shadow-[0_0_40px_rgb(255_255_255/0.45)]" />
                </div>
                <dl ref={stats} className="absolute inset-x-[5vw] top-[66%] flex justify-between gap-4 sm:inset-x-auto sm:right-[4vw] sm:top-1/2 sm:-translate-y-1/2 sm:flex-col sm:items-end sm:gap-8 sm:text-right">
                    {STATS.map((s) => (
                        <div key={s.label} data-stat>
                            <dt className="sr-only">{s.label}</dt>
                            <dd className="cine-display text-[clamp(1.6rem,3vw,2.4rem)] font-medium leading-none tracking-tight">{s.value}</dd>
                            <dd className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-white/45">{s.label}</dd>
                        </div>
                    ))}
                </dl>
                <div ref={copy} className="absolute bottom-[22vh] left-[4vw] hidden max-w-[21rem] space-y-4 text-[13.5px] leading-relaxed text-white/60 sm:block">
                    <p>
                        FreeAgentCoder maps a repository first: its stack, its layers, and every file a change would reach. Only then does it write code, and it proves
                        the result against your own tests.
                    </p>
                    <p>It runs on free keys you own, in the VS Code you already use. No subscription, no credits, no meter running while you think.</p>
                </div>
            </div>
        </section>
    );
}
