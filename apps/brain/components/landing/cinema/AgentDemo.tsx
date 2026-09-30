'use client';

import { useEffect, useState } from 'react';
import { Logo } from '@/components/Logo';

/**
 * The extension's chat panel, acting out one real task: someone asks for a
 * portfolio site, the agent writes the files one by one, and the page builds
 * itself in the preview underneath. Sized in container units, so it is the
 * same picture at any width. With reduced motion it shows the finished state.
 */

const PROMPT = 'Build a portfolio website for me';
const TYPE_FROM = 500;
const TYPE_MS = 42;
const SENT = TYPE_FROM + PROMPT.length * TYPE_MS + 300;
const STEPS = [
    { at: SENT + 500, text: 'Planned the site · 3 files' },
    { at: SENT + 1500, text: 'Wrote index.html' },
    { at: SENT + 2600, text: 'Wrote styles.css' },
    { at: SENT + 3600, text: 'Wrote projects.js' },
];
const PREVIEW = { nav: SENT + 1700, name: SENT + 2100, role: SENT + 2500, button: SENT + 2900, cards: [SENT + 3300, SENT + 3700, SENT + 4100] };
const DONE = SENT + 4700;
const LOOP = DONE + 3800;

function Check() {
    return (
        <svg viewBox="0 0 16 16" className="size-[3.6cqw] shrink-0 text-lime-300" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3.5 8.5l3 3 6-7" />
        </svg>
    );
}

/** Fades and lifts a piece in once the clock passes `at`. */
const shown = (t: number, at: number) => (t >= at ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-[1.5cqw]');

export function AgentDemo({ width }: { width: string }) {
    const [t, setT] = useState(0);

    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setT(DONE + 1);
            return;
        }
        const started = performance.now();
        const timer = window.setInterval(() => setT((performance.now() - started) % LOOP), 50);
        return () => window.clearInterval(timer);
    }, []);

    const typed = PROMPT.slice(0, Math.max(0, Math.min(PROMPT.length, Math.floor((t - TYPE_FROM) / TYPE_MS))));
    const sent = t >= SENT;
    const done = t >= DONE;
    const seconds = Math.max(1, Math.floor((t - SENT) / 1000));

    return (
        // The wrapper is the size container; the card inside is measured against it.
        <div className={`${width} [container-type:inline-size]`} aria-hidden>
        <div className="cine-glass relative flex aspect-[0.68] w-full flex-col overflow-hidden rounded-[22px] p-[4cqw] text-white">
            <div className="cine-live-glow pointer-events-none absolute inset-0 opacity-60" />

            {/* The panel header, as in the extension. */}
            <div className="relative flex items-center justify-between">
                <span className="flex items-center gap-[2cqw] text-[4.2cqw] font-semibold">
                    <Logo size={14} className="size-[4.4cqw] text-white" /> FreeAgentCoder
                </span>
                <span className="flex items-center gap-[1.5cqw] rounded-full bg-black/35 px-[2.4cqw] py-[1cqw] text-[3cqw] font-semibold tracking-wide text-white/80">
                    <span className="size-[1.6cqw] animate-pulse rounded-full bg-lime-300" /> LIVE
                </span>
            </div>

            {/* What the person asked, typed out. */}
            <div className="relative mt-[4cqw] flex justify-end">
                <div
                    className={`max-w-[88%] rounded-[3cqw_3cqw_1cqw_3cqw] border px-[3cqw] py-[2cqw] text-[3.7cqw] leading-snug transition-colors ${
                        sent ? 'border-white/10 bg-white/10' : 'border-white/25 bg-black/40'
                    }`}
                >
                    {typed || <span className="text-white/40">Describe what to build…</span>}
                    {!sent && typed && <span className="ml-[0.5cqw] inline-block h-[3.6cqw] w-[0.5cqw] translate-y-[0.5cqw] animate-pulse bg-white" />}
                </div>
            </div>

            {/* The agent's steps. */}
            <ul className="relative mt-[3cqw] grid gap-[1.6cqw] text-[3.3cqw] text-white/75">
                {STEPS.map((step) => (
                    <li key={step.text} className={`flex items-center gap-[2cqw] transition-all duration-500 ${shown(t, step.at)}`}>
                        <Check />
                        <span className="font-mono text-[3.1cqw]">{step.text}</span>
                    </li>
                ))}
            </ul>

            {/* The preview, building up as the files land. */}
            <div className="relative mt-[3.5cqw] flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2.6cqw] border border-white/15 bg-[#f4f4f5] text-zinc-900 shadow-[0_20px_40px_-20px_rgb(0_0_0/0.8)]">
                <div className="flex items-center gap-[1.4cqw] border-b border-zinc-200 bg-zinc-100 px-[2.4cqw] py-[1.6cqw]">
                    <span className="size-[1.8cqw] rounded-full bg-zinc-300" />
                    <span className="size-[1.8cqw] rounded-full bg-zinc-300" />
                    <span className="size-[1.8cqw] rounded-full bg-zinc-300" />
                    <span className="ml-[2cqw] flex-1 truncate rounded-full bg-white px-[2cqw] py-[0.4cqw] font-mono text-[2.5cqw] text-zinc-500">
                        {sent ? 'preview · running in your browser' : 'preview'}
                    </span>
                </div>
                <div className="relative flex flex-1 flex-col px-[3.5cqw] py-[3cqw]">
                    {!sent && <span className="m-auto text-[3cqw] text-zinc-400">Nothing here yet</span>}
                    <div className={`flex items-center justify-between transition-all duration-500 ${shown(t, PREVIEW.nav)}`}>
                        <span className="text-[3cqw] font-bold tracking-tight">alex.dev</span>
                        <span className="flex gap-[2cqw] text-[2.4cqw] text-zinc-500">
                            <span>Work</span>
                            <span>About</span>
                            <span>Contact</span>
                        </span>
                    </div>
                    <div className="mt-[3cqw] flex items-center gap-[3cqw]">
                        <span className={`size-[9cqw] shrink-0 rounded-full bg-[radial-gradient(circle_at_30%_30%,#d4d4d8,#52525b)] transition-all duration-500 ${shown(t, PREVIEW.name)}`} />
                        <div>
                            <p className={`text-[4.6cqw] font-bold leading-none tracking-tight transition-all duration-500 ${shown(t, PREVIEW.name)}`}>Hi, I&rsquo;m Alex.</p>
                            <p className={`mt-[1cqw] text-[2.7cqw] text-zinc-500 transition-all duration-500 ${shown(t, PREVIEW.role)}`}>Designer and front-end developer</p>
                        </div>
                    </div>
                    <span className={`mt-[2.6cqw] w-fit rounded-[1.4cqw] bg-zinc-900 px-[2.4cqw] py-[1cqw] text-[2.5cqw] font-medium text-white transition-all duration-500 ${shown(t, PREVIEW.button)}`}>
                        See my work
                    </span>
                    <div className="mt-auto grid grid-cols-3 gap-[1.8cqw] pt-[3cqw]">
                        {PREVIEW.cards.map((at, i) => (
                            <span
                                key={at}
                                className={`aspect-[1.1] rounded-[1.6cqw] transition-all duration-500 ${shown(t, at)}`}
                                style={{ background: ['linear-gradient(135deg,#27272a,#71717a)', 'linear-gradient(135deg,#a1a1aa,#e4e4e7)', 'linear-gradient(135deg,#3f3f46,#18181b)'][i] }}
                            />
                        ))}
                    </div>
                </div>
            </div>

            {/* Status, as the extension shows it. */}
            <div className="relative mt-[3cqw] flex items-center gap-[2cqw] text-[3.2cqw] text-white/70">
                {done ? (
                    <>
                        <Check /> Done · 3 files changed
                    </>
                ) : sent ? (
                    <>
                        <span className="inline-block size-[3.2cqw] animate-spin rounded-full border-[0.5cqw] border-white/20 border-t-white" />
                        <span className="flex-1">Writing the code…</span>
                        <span className="tabular-nums text-white/45">{seconds}s</span>
                    </>
                ) : (
                    <span className="text-white/45">Enter to send</span>
                )}
            </div>
        </div>
        </div>
    );
}
