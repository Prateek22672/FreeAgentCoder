'use client';

import { useEffect, useState } from 'react';
import { Logo } from '@/components/Logo';
import { InstallLink } from '@/components/InstallLink';
import { Arrow } from './Hero';

/** Real requests, and the commands Fyx really produces for them. */
const CHORES = [
    { word: 'run your project', ask: 'run the website locally', run: 'npm --prefix homes run dev', result: 'Running at http://localhost:5173' },
    { word: 'zip a folder', ask: 'zip the homes folder', run: 'tar -a -c -f homes.zip homes', result: 'homes.zip · node_modules left out' },
    { word: 'push to git', ask: 'commit with message "fix navbar" and push', run: 'git commit -m "fix navbar" && git push', result: 'Committed and pushed' },
    { word: 'install packages', ask: 'add axios and zod', run: 'npm install axios zod', result: 'Added 2 packages' },
    { word: 'make a branch', ask: 'create a branch called feature/login', run: 'git switch -c feature/login', result: 'On feature/login' },
];

const STATS = [
    { value: '0', label: 'tokens' },
    { value: '0.2 s', label: 'vs 4 min 36 s' },
    { value: '1', label: 'command, you approve' },
];

/**
 * Fyx in one card: a rotating line of chores it does, three small numbers, and
 * the extension's panel doing the same chore, as in the hero.
 */
export function Chores() {
    const [index, setIndex] = useState(0);
    const [still, setStill] = useState(false);

    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setStill(true);
            return;
        }
        const timer = window.setInterval(() => setIndex((i) => (i + 1) % CHORES.length), 3_200);
        return () => window.clearInterval(timer);
    }, []);

    const chore = CHORES[index]!;

    return (
        <section className="bg-[#070708] px-2 pb-2 pt-4 sm:px-3 sm:pb-3 sm:pt-6" aria-labelledby="fyx-title">
            <div className="fyx-card relative overflow-hidden rounded-[22px] px-6 py-14 text-white sm:rounded-[28px] sm:px-12 sm:py-16">
                <div className="relative grid items-center gap-12 lg:grid-cols-[1.15fr_1fr]">
                    <div>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[12px] font-medium backdrop-blur">
                            <Bolt /> Meet Fyx · built in
                        </span>
                        <h2 id="fyx-title" className="cine-display mt-6 text-[clamp(2.2rem,5.4vw,4.2rem)] font-medium leading-[1.02] tracking-[-0.04em]">
                            Fyx can{' '}
                            <span key={chore.word} className={`fyx-word inline-block text-[#ffd2bf] ${still ? '' : 'fyx-word-in'}`}>
                                {chore.word}
                            </span>
                            <br />
                            <span className="text-white/55">with zero tokens.</span>
                        </h2>
                        <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/70">
                            Our own task engine for everyday chores. No AI model, so it is instant and your free keys stay for real work. Anything complex goes to the agent.
                        </p>
                        <dl className="mt-8 grid max-w-md grid-cols-3 gap-3">
                            {STATS.map((s) => (
                                <div key={s.label} className="rounded-[14px] border border-white/15 bg-white/[0.08] px-3 py-3 backdrop-blur">
                                    <dd className="cine-display text-[1.6rem] font-medium leading-none">{s.value}</dd>
                                    <dt className="mt-1.5 text-[11.5px] text-white/60">{s.label}</dt>
                                </div>
                            ))}
                        </dl>
                        <InstallLink className="group mt-8 inline-flex items-center gap-2 rounded-[12px] bg-white px-5 py-3 text-[14.5px] font-medium text-zinc-950 shadow-[0_14px_40px_-12px_rgb(0_0_0/0.5)] transition-transform hover:scale-[1.03]">
                            Get Fyx in VS Code, free <span className="transition-transform group-hover:translate-x-0.5"><Arrow size={14} /></span>
                        </InstallLink>
                    </div>

                    {/* The extension's panel, doing the chore named on the left. */}
                    <div className="mx-auto w-full max-w-[400px] rounded-[18px] border border-white/10 bg-[#181818] text-[#cccccc] shadow-[0_40px_90px_-30px_rgb(0_0_0/0.9)]" aria-hidden>
                        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
                            <Logo size={15} className="text-[#d97757]" />
                            <span className="flex-1 text-[14px] font-semibold text-white">FreeAgentCoder</span>
                            <span className="flex items-center gap-1 rounded-full border border-[#d97757]/40 bg-[#d97757]/10 px-2 py-0.5 text-[11px] font-medium text-[#ffb59a]">
                                <Bolt /> Fyx · 0 tokens
                            </span>
                        </div>
                        <div key={chore.ask} className={`flex flex-col gap-3 px-4 py-4 ${still ? '' : 'fyx-panel-in'}`}>
                            <div className="self-end rounded-[12px] border border-white/10 bg-[#222] px-3 py-2 text-[13px] text-white">{chore.ask}</div>
                            <div className="flex items-center gap-1.5 text-[12.5px]">
                                <Logo size={12} className="text-[#d97757]" />
                                <span className="font-semibold text-white">Fyx</span>
                                <span className="text-white/40">· on your machine, no AI model</span>
                            </div>
                            <div className="overflow-hidden rounded-[10px] border border-white/10 bg-[#0f0f0f]">
                                <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5 text-[11px] text-white/45">
                                    <span>Command</span>
                                    <span className="text-[#4ade80]">approved</span>
                                </div>
                                <p className="truncate px-3 pt-2 font-mono text-[12px] text-white/85">$ {chore.run}</p>
                                <p className="px-3 pb-2.5 pt-1 text-[12px] text-[#4ade80]">✓ {chore.result}</p>
                            </div>
                            <div className="flex items-center gap-2 border-t border-dashed border-white/10 pt-2.5 text-[12px]">
                                <span className="text-[#4ade80]">✓</span>
                                <span className="font-semibold text-white">Done</span>
                                <span className="text-white/45">1 step · 0.2 s · 0 tokens</span>
                            </div>
                        </div>
                        <div className="px-3 pb-3">
                            <div className="flex items-center gap-2 rounded-[10px] border border-white/10 bg-[#1f1f1f] px-3 py-2 text-[12px] text-white/40">
                                <span className="flex-1">Ask FreeAgentCoder to build, fix or explain…</span>
                                <span className="flex items-center gap-1 text-[#ffb59a]">
                                    <Bolt /> Fyx
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

function Bolt() {
    return (
        <svg viewBox="0 0 16 16" width={12} height={12} fill="currentColor" aria-hidden>
            <path d="M9 1.5 3.5 9h4L7 14.5 12.5 7h-4L9 1.5Z" />
        </svg>
    );
}
