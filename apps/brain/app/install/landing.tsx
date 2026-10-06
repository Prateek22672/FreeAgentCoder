'use client';

import { useEffect, useState } from 'react';
import { Logo } from '@/components/Logo';
import { canonical, MARKETPLACE, VSCODE_INSTALL } from '@/lib/site';

type Device = 'unknown' | 'desktop' | 'phone';

/**
 * On a computer it asks the browser to open VS Code on the extension straight
 * away (the browser shows its own "Open Visual Studio Code?" prompt), with a
 * button for a second try. A phone cannot run VS Code, so there it offers to
 * copy or send the link to a computer instead.
 */
export function InstallLanding() {
    const [device, setDevice] = useState<Device>('unknown');
    const [tried, setTried] = useState(false);
    const [copied, setCopied] = useState(false);
    const link = canonical('/install');

    useEffect(() => {
        const phone = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.matchMedia('(pointer: coarse) and (max-width: 820px)').matches;
        setDevice(phone ? 'phone' : 'desktop');
        if (!phone) {
            // Once, a moment after the page shows, so people see where they are when the prompt appears.
            const timer = window.setTimeout(() => {
                window.location.href = VSCODE_INSTALL;
                setTried(true);
            }, 700);
            return () => window.clearTimeout(timer);
        }
    }, []);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2_000);
        } catch {
            // The link is shown on the page; it can be selected by hand.
        }
    };
    const share = async () => {
        if (navigator.share) {
            await navigator.share({ title: 'FreeAgentCoder', text: 'Free AI coding agent for VS Code', url: link }).catch(() => undefined);
        } else {
            await copy();
        }
    };

    return (
        <main className="force-dark relative flex min-h-dvh items-center justify-center overflow-hidden bg-[#070708] px-5 py-16 text-white">
            <div className="pointer-events-none absolute left-1/2 top-1/2 size-[80vmax] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(217,119,87,0.16),transparent_60%)]" aria-hidden />
            <div className="relative w-full max-w-md text-center">
                <Logo size={56} className="mx-auto text-[#d97757]" />
                <h1 className="cine-display mt-6 text-[clamp(2rem,7vw,2.8rem)] font-medium leading-[1.05] tracking-[-0.035em]">FreeAgentCoder</h1>
                <p className="mt-3 text-[15px] leading-relaxed text-white/65">
                    The free AI coding agent for VS Code. It plans, writes, runs and tests code in your project, on free keys. No subscription.
                </p>

                {device === 'phone' ? (
                    <div className="mt-8 rounded-[18px] border border-white/10 bg-white/[0.05] p-5 text-left">
                        <p className="text-[15px] font-semibold">Open this link on your computer</p>
                        <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/60">FreeAgentCoder runs inside VS Code on Windows, Mac or Linux. Send yourself the link and open it there: VS Code opens on the extension, ready to install.</p>
                        <div className="mt-4 flex gap-2">
                            <button type="button" onClick={share} className="flex-1 rounded-[12px] bg-white px-4 py-3 text-[14.5px] font-semibold text-zinc-950">
                                Send to my computer
                            </button>
                            <button type="button" onClick={copy} className="rounded-[12px] border border-white/15 px-4 py-3 text-[14px] font-medium">
                                {copied ? 'Copied' : 'Copy link'}
                            </button>
                        </div>
                        <p className="mt-3 select-all break-all font-mono text-[12px] text-white/45">{link}</p>
                    </div>
                ) : (
                    <div className="mt-8">
                        <a
                            href={VSCODE_INSTALL}
                            onClick={() => setTried(true)}
                            className="inline-flex w-full items-center justify-center gap-2.5 rounded-[14px] bg-white px-6 py-4 text-[16px] font-semibold text-zinc-950 shadow-[0_20px_50px_-20px_rgb(255_255_255/0.4)] transition-transform hover:scale-[1.02]"
                        >
                            <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" aria-hidden>
                                <path d="M17.6 2.3 9.1 10 4.2 6.3 2 7.4v9.2l2.2 1.1 4.9-3.7 8.5 7.7L22 19.9V4.1l-4.4-1.8ZM4.4 14.6V9.4L7 12l-2.6 2.6Zm13.2 1.6L12.6 12l5-4.2v8.4Z" />
                            </svg>
                            Open in VS Code
                        </a>
                        <p className="mt-3 text-[13px] leading-relaxed text-white/55">
                            {tried ? (
                                <>
                                    If your browser asks, choose <span className="text-white">Open Visual Studio Code</span>, then click <span className="text-white">Install</span>.
                                </>
                            ) : (
                                'Opening VS Code…'
                            )}
                        </p>
                        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[13px] text-white/55">
                            <a href="https://code.visualstudio.com/download" target="_blank" rel="noreferrer noopener" className="underline-offset-4 hover:text-white hover:underline">
                                No VS Code? Get it free
                            </a>
                            <span aria-hidden>·</span>
                            <a href={MARKETPLACE} target="_blank" rel="noreferrer noopener" className="underline-offset-4 hover:text-white hover:underline">
                                Marketplace page
                            </a>
                            <span aria-hidden>·</span>
                            <button type="button" onClick={copy} className="underline-offset-4 hover:text-white hover:underline">
                                {copied ? 'Link copied' : 'Copy this link'}
                            </button>
                        </div>
                    </div>
                )}

                <a href="/" className="mt-10 inline-block text-[13px] text-white/45 hover:text-white">
                    See what it does →
                </a>
            </div>
        </main>
    );
}
