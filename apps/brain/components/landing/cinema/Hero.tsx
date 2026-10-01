'use client';

import { useRef } from 'react';
import { InstallLink } from '@/components/InstallLink';
import { AgentDemo } from './AgentDemo';
import { ease, span, useScrollProgress } from './progress';

export function Star({ size = 14, className }: { size?: number; className?: string }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor" aria-hidden>
            <path d="M12 0c.9 6.6 4.8 10.9 12 12-7.2 1.1-11.1 5.4-12 12-.9-6.6-4.8-10.9-12-12C7.2 10.9 11.1 6.6 12 0z" />
        </svg>
    );
}

function DownloadIcon() {
    return (
        <svg viewBox="0 0 16 16" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
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
                            <AgentDemo width="w-[min(220px,27vh)]" />
                        </div>
                        <div className="flex flex-col gap-8 md:mt-auto md:flex-row md:items-end md:justify-between">
                            <div className="max-w-[26rem]">
                                <p className="text-[15px] leading-relaxed text-white/80 sm:text-[16px]">
                                    A free AI coding agent that reads your code before it changes it. Understand any repository, then let it build, in your browser or in VS
                                    Code, on your own free keys.
                                </p>
                                <div className="mt-7 flex flex-wrap items-stretch gap-3">
                                    {/* The main action: install, in two lines, like a download button. */}
                                    <InstallLink className="group inline-flex items-center gap-3 rounded-[14px] bg-white py-2.5 pl-3.5 pr-5 text-zinc-950 shadow-[0_14px_40px_-12px_rgb(0_0_0/0.6)] transition-transform hover:scale-[1.03]">
                                        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-zinc-950 text-white">
                                            <DownloadIcon />
                                        </span>
                                        <span className="flex flex-col text-left leading-tight">
                                            <span className="text-[15px] font-semibold">Install extension</span>
                                            <span className="text-[11.5px] font-medium text-zinc-500">for VS Code · free</span>
                                        </span>
                                    </InstallLink>
                                    <a
                                        href="/playground"
                                        className="group inline-flex items-center gap-2 rounded-[14px] border border-white/15 bg-white/10 px-5 text-[14.5px] font-medium text-white backdrop-blur transition-colors hover:bg-white/20"
                                    >
                                        <span>
                                            Try <span className="hidden sm:inline">it </span>in <span className="hidden sm:inline">the </span>browser
                                        </span>{' '}
                                        <span className="transition-transform group-hover:translate-x-0.5"><Arrow size={14} /></span>
                                    </a>
                                </div>
                            </div>
                            <p className="hidden max-w-[19rem] text-right text-[13px] leading-relaxed text-white/60 xl:block">
                                From a GitHub link to a verified change: it maps the code, plans the edit and runs your tests before it says done.
                            </p>
                        </div>
                    </div>
                    <div ref={live} className="absolute right-[7%] top-[13%] hidden will-change-transform md:block">
                        <AgentDemo width="w-[min(340px,44vh,26vw)]" />
                    </div>
                </div>
            </div>
        </section>
    );
}
