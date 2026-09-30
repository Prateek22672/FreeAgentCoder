'use client';

import { useEffect, useRef, useState } from 'react';
import { ease, span, useScrollProgress } from './progress';

/** What the live card shows, one after another: the agent's real loop. */
const SESSIONS = [
    { task: 'Add dark mode to the settings page', done: 'Tests passing', detail: '3 files changed · checked in 41 s' },
    { task: 'Why does checkout fail on refresh?', done: 'Cause found', detail: 'cart/session.ts, lines 88–104' },
    { task: 'Replace Prisma with Drizzle', done: 'Plan ready', detail: '14 files reached · risk: medium' },
];

const PROVIDERS = [
    { name: 'Gemini', color: '#4f7cff' },
    { name: 'Groq', color: '#f55036' },
    { name: 'Mistral', color: '#ff8a00' },
    { name: 'OpenRouter', color: '#8b5cf6' },
    { name: 'Claude', color: '#d97757' },
];

function LiveCard({ width = 'w-[min(300px,38vh)]' }: { width?: string }) {
    const [index, setIndex] = useState(0);
    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const timer = window.setInterval(() => setIndex((i) => (i + 1) % SESSIONS.length), 4200);
        return () => window.clearInterval(timer);
    }, []);
    const session = SESSIONS[index];
    return (
        <div className={`cine-glass relative flex aspect-[0.72] ${width} flex-col overflow-hidden rounded-[22px] p-3.5 text-white`} aria-hidden>
            <div className="cine-live-glow pointer-events-none absolute inset-0" />
            <div className="relative flex items-center justify-between">
                <span className="flex items-center gap-1.5 rounded-full bg-black/30 px-2.5 py-1 text-[11.5px] font-medium">
                    <Star size={10} /> Live session
                </span>
                <span className="flex items-center gap-1.5 rounded-full bg-black/30 px-2 py-1 text-[10px] font-semibold tracking-wide text-white/80">
                    <span className="size-1.5 animate-pulse rounded-full bg-lime-300" /> LIVE
                </span>
            </div>
            <div className="relative mt-auto">
                <div key={session.task} className="cine-fade-in flex items-center gap-3 rounded-xl border border-white/15 bg-black/35 py-2.5 pl-3 pr-2 text-[13px] backdrop-blur-md">
                    <span className="flex-1 truncate">{session.task}</span>
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white text-zinc-900">
                        <Arrow />
                    </span>
                </div>
                <div key={`bars-${index}`} className="mt-2.5 grid grid-cols-5 gap-1.5 px-0.5">
                    {[0, 1, 2, 3, 4].map((i) => (
                        <span key={i} className="h-[3px] overflow-hidden rounded-full bg-white/20">
                            <span className="cine-bar block h-full rounded-full bg-white" style={{ animationDelay: `${i * 0.55}s` }} />
                        </span>
                    ))}
                </div>
            </div>
            <div className="relative mt-auto pt-10">
                <p key={session.done} className="cine-fade-in text-[15px] font-semibold">
                    {session.done}
                </p>
                <p className="mt-0.5 text-[11.5px] text-white/60">{session.detail}</p>
            </div>
        </div>
    );
}

export function Star({ size = 14, className }: { size?: number; className?: string }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor" aria-hidden>
            <path d="M12 0c.9 6.6 4.8 10.9 12 12-7.2 1.1-11.1 5.4-12 12-.9-6.6-4.8-10.9-12-12C7.2 10.9 11.1 6.6 12 0z" />
        </svg>
    );
}

export function Arrow({ size = 13 }: { size?: number }) {
    return (
        <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 8h10M9 4l4 4-4 4" />
        </svg>
    );
}

/**
 * The opening card. Scrolling pushes its contents back into the card, as if
 * the camera pulls away, and then the whole card rises off the page.
 */
export function Hero() {
    const host = useRef<HTMLElement>(null);
    const content = useRef<HTMLDivElement>(null);
    const live = useRef<HTMLDivElement>(null);

    useScrollProgress(
        host,
        (p) => {
            const t = ease(span(p, 0, 1));
            if (content.current) content.current.style.transform = `translate3d(0, ${t * 5}vh, 0) scale(${1 - t * 0.2})`;
            if (live.current) live.current.style.transform = `translate3d(${-t * 4}vw, ${t * 16}vh, 0)`;
        },
        0,
    );

    return (
        <section ref={host} className="cine-hero relative h-[150vh] bg-[#ececf0]">
            <div className="sticky top-0 h-dvh p-2 sm:p-3">
                <div className="cine-graphite relative h-full overflow-hidden rounded-[22px] sm:rounded-[28px]">
                    <div ref={content} className="relative flex h-full origin-center flex-col px-6 pb-8 pt-24 will-change-transform sm:px-12 sm:pb-10 sm:pt-[4.5rem]">
                        <h1 className="cine-display text-[clamp(2.9rem,9.2vw,7.4rem)] font-semibold leading-[0.95] tracking-[-0.035em]">
                            <span className="block text-white">Your codebase</span>
                            <span className="block text-white/45">has a brain.</span>
                        </h1>

                        {/* On a phone the card sits in the space between the headline and the copy. */}
                        <div className="flex flex-1 items-center justify-center py-4 md:hidden">
                            <LiveCard width="w-[min(230px,28vh)]" />
                        </div>
                        <div className="flex flex-col gap-8 md:mt-auto md:flex-row md:items-end md:justify-between">
                            <div className="max-w-[26rem]">
                                <p className="text-[15px] leading-relaxed text-white/80 sm:text-[16px]">
                                    A free AI coding agent that reads your code before it changes it. Understand any repository, then let it build, in your browser or in VS
                                    Code, on your own free keys.
                                </p>
                                <div className="mt-7 flex flex-wrap gap-3">
                                    <a href="#brain" className="rounded-[12px] border border-white/15 bg-white/10 px-5 py-3 text-[14.5px] font-medium text-white backdrop-blur transition-colors hover:bg-white/20">
                                        Read a repo
                                    </a>
                                    <a
                                        href="/playground"
                                        className="group inline-flex items-center gap-2 rounded-[12px] bg-white px-5 py-3 text-[14.5px] font-medium text-zinc-950 shadow-[0_10px_30px_-10px_rgb(0_0_0/0.5)] transition-transform hover:scale-[1.03]"
                                    >
                                        Start building <span className="transition-transform group-hover:translate-x-0.5"><Arrow size={14} /></span>
                                    </a>
                                </div>
                                <div className="mt-7 inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/10 py-1.5 pl-1.5 pr-4 text-[13px] text-white/85 backdrop-blur">
                                    <span className="flex -space-x-1.5">
                                        {PROVIDERS.map((p) => (
                                            <span
                                                key={p.name}
                                                title={p.name}
                                                className="flex size-6 items-center justify-center rounded-full border-2 border-[#1c1c1f] text-[10px] font-bold text-white"
                                                style={{ background: `radial-gradient(circle at 30% 30%, color-mix(in srgb, ${p.color} 60%, white), ${p.color})` }}
                                            >
                                                {p.name[0]}
                                            </span>
                                        ))}
                                    </span>
                                    Works with Gemini, Groq, Claude and more
                                </div>
                            </div>
                            <p className="hidden max-w-[19rem] text-right text-[13px] leading-relaxed text-white/60 md:block">
                                From a GitHub link to a verified change: it maps the code, plans the edit and runs your tests before it says done.
                            </p>
                        </div>
                    </div>
                    <div ref={live} className="absolute right-[9%] top-[22%] hidden rotate-[-2deg] will-change-transform md:block">
                        <LiveCard />
                    </div>
                </div>
            </div>
        </section>
    );
}
