'use client';

import { useRef, useState } from 'react';
import { InstallLink } from '@/components/InstallLink';
import { AgentDemo } from './AgentDemo';
import { ease, span, useScrollProgress } from './progress';

/** What you type in VS Code's Quick Open (Ctrl+P) to install the extension. */
const INSTALL = 'ext install PrateekKoratala.freeagentcoder';

/** The install command, one click to copy: the real first step, not a badge. */
function InstallCommand() {
    const [copied, setCopied] = useState(false);
    const copy = () => {
        void navigator.clipboard?.writeText(INSTALL).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
        });
    };
    return (
        <div className="mt-7 inline-flex max-w-full items-center gap-3 rounded-[12px] border border-white/10 bg-black/40 py-1.5 pl-3 pr-1.5 backdrop-blur">
            <span className="shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[10.5px] text-white/60">Ctrl P</span>
            <code className="truncate font-mono text-[12.5px] text-white/85">
                <span className="text-white/40">&gt; </span>
                {INSTALL}
            </code>
            <button
                type="button"
                onClick={copy}
                aria-label="Copy the install command"
                className="shrink-0 rounded-[8px] bg-white/10 px-2.5 py-1 text-[12px] font-medium text-white transition-colors hover:bg-white hover:text-zinc-950"
            >
                {copied ? 'Copied' : 'Copy'}
            </button>
            <InstallLink className="shrink-0 rounded-[8px] bg-white px-3 py-1 text-[12px] font-semibold text-zinc-950 transition-transform hover:scale-[1.04]">Install</InstallLink>
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
                            <AgentDemo width="w-[min(250px,32vh)]" />
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
                                <InstallCommand />
                            </div>
                            <p className="hidden max-w-[19rem] text-right text-[13px] leading-relaxed text-white/60 md:block">
                                From a GitHub link to a verified change: it maps the code, plans the edit and runs your tests before it says done.
                            </p>
                        </div>
                    </div>
                    <div ref={live} className="absolute right-[8%] top-[15%] hidden rotate-[-2deg] will-change-transform md:block">
                        <AgentDemo width="w-[min(340px,44vh)]" />
                    </div>
                </div>
            </div>
        </section>
    );
}
