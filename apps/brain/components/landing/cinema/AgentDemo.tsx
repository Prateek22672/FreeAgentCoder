'use client';

import { useEffect, useState } from 'react';
import { Logo } from '@/components/Logo';

/**
 * The extension's side panel, drawn as it really looks in VS Code, acting out
 * one task: the request is typed into the composer and sent, the agent's reply
 * shows its method and model, writes the files one by one, and the site builds
 * itself in a preview inside the reply. Sized in container units, so it is the
 * same picture at any width. With reduced motion it shows the finished state.
 */

const PROMPT = 'Build a portfolio website for me';
const TYPE_FROM = 600;
const TYPE_MS = 45;
const SENT = TYPE_FROM + PROMPT.length * TYPE_MS + 400;
const REPLY = SENT + 400;
const STEPS = [
    { at: SENT + 900, file: 'Planned the site', note: '3 files' },
    { at: SENT + 1800, file: 'index.html', note: '+48' },
    { at: SENT + 2800, file: 'styles.css', note: '+96' },
    { at: SENT + 3800, file: 'projects.js', note: '+31' },
];
const PREVIEW = { frame: SENT + 2000, nav: SENT + 2200, name: SENT + 2600, role: SENT + 3000, button: SENT + 3300, cards: [SENT + 3900, SENT + 4200, SENT + 4500] };
const DONE = SENT + 5200;
const LOOP = DONE + 4200;

const ACCENT = '#d97757';

/** Fades and lifts a piece in once the clock passes `at`. */
const shown = (t: number, at: number) => (t >= at ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 translate-y-[1.5cqw]');
/** Takes no room until the clock passes `at`, so the conversation grows as it would. */
const present = (t: number, at: number) => (t >= at ? '' : 'hidden');

function Check({ className = 'text-[#4ade80]' }: { className?: string }) {
    return (
        <svg viewBox="0 0 16 16" className={`size-[3.4cqw] shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3.5 8.5l3 3 6-7" />
        </svg>
    );
}

function Icon({ d, className = '' }: { d: string; className?: string }) {
    return (
        <svg viewBox="0 0 16 16" className={`size-[3.8cqw] shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={d} />
        </svg>
    );
}

const PLUS = 'M8 3v10M3 8h10';
const HISTORY = 'M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.6h2.6M8 5.2V8l2 1.3';
const GEAR = 'M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4ZM13 8a5 5 0 0 0-.1-1l1.4-1.1-1.4-2.4-1.7.6a5 5 0 0 0-1.7-1L9.2 1.3H6.8l-.3 1.8a5 5 0 0 0-1.7 1l-1.7-.6-1.4 2.4L3.1 7a5 5 0 0 0 0 2l-1.4 1.1 1.4 2.4 1.7-.6a5 5 0 0 0 1.7 1l.3 1.8h2.4l.3-1.8a5 5 0 0 0 1.7-1l1.7.6 1.4-2.4L12.9 9c.1-.3.1-.7.1-1Z';
const CLIP = 'M10.5 4.5 5.3 9.7a1.6 1.6 0 0 0 2.3 2.3l5.6-5.6a3 3 0 0 0-4.3-4.3L3.3 7.7a4.4 4.4 0 0 0 6.2 6.2L13 10.4';
const BOLT = 'M9 1.5 3.5 9h4L7 14.5 12.5 7h-4L9 1.5Z';
const SPARK = 'M8 1.5c.5 3.4 2.4 5.6 6 6.5-3.6.9-5.5 3.1-6 6.5-.5-3.4-2.4-5.6-6-6.5 3.6-.9 5.5-3.1 6-6.5Z';

/** `frozen` shows the finished task and takes no input: for the copy that flies into the carousel. */
export function AgentDemo({ width, frozen = false }: { width: string; frozen?: boolean }) {
    const [t, setT] = useState(0);
    // Once someone clicks into the box it is theirs: the demo stops, and Enter builds it for real.
    const [draft, setDraft] = useState<string>();
    const [going, setGoing] = useState(false);
    const engaged = draft !== undefined;

    useEffect(() => {
        if (engaged) {
            setT(0);
            return;
        }
        if (frozen || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setT(DONE + 1);
            return;
        }
        const started = performance.now();
        const timer = window.setInterval(() => setT((performance.now() - started) % LOOP), 50);
        return () => window.clearInterval(timer);
    }, [engaged, frozen]);

    const build = () => {
        const ask = (draft ?? '').trim();
        if (!ask) {
            return;
        }
        setGoing(true);
        // A real page load: Fyxable needs its own isolation headers to run the app.
        window.location.assign(`/fyxable?ask=${encodeURIComponent(ask.slice(0, 400))}`);
    };

    const typing = !engaged && t >= TYPE_FROM && t < SENT;
    const typed = typing ? PROMPT.slice(0, Math.min(PROMPT.length, Math.floor((t - TYPE_FROM) / TYPE_MS))) : '';
    const sent = !engaged && t >= SENT;
    const done = t >= DONE;
    const seconds = Math.max(1, Math.floor((t - REPLY) / 1000));
    const tokens = done ? '6.1K' : sent ? `${(1 + Math.min(5, (t - SENT) / 1000)).toFixed(1)}K` : '0';

    return (
        // The wrapper is the size container; the panel inside is measured against it.
        <div className={`${width} [container-type:inline-size] ${frozen ? 'panel-still' : ''}`}>
            <div className="relative flex aspect-[0.56] w-full flex-col overflow-hidden rounded-[3.6cqw] border border-white/10 bg-[#181818] text-[#cccccc] shadow-[0_40px_90px_-30px_rgb(0_0_0/0.9)]">
                {/* Panel header, as in the extension. */}
                <div className="flex items-center gap-[2.4cqw] border-b border-white/[0.06] px-[4cqw] py-[3cqw]">
                    <Logo size={14} className="size-[4.6cqw] text-[#d97757]" />
                    <span className="flex-1 text-[4.2cqw] font-semibold text-white">FreeAgentCoder</span>
                    <span className="flex items-center gap-[3cqw] text-white/55">
                        <Icon d={PLUS} />
                        <Icon d={HISTORY} />
                        <Icon d={GEAR} />
                    </span>
                </div>

                {/* The conversation, newest at the bottom. */}
                <div aria-hidden className="flex min-h-0 flex-1 flex-col justify-end gap-[2.4cqw] overflow-hidden px-[4cqw] pb-[2cqw] pt-[3cqw]">
                    {!sent && (
                        <div className="m-auto flex flex-col items-center gap-[2cqw] text-center">
                            <Logo size={28} className="size-[9cqw] text-[#d97757]" />
                            <p className="text-[4cqw] font-semibold text-white">What should we build?</p>
                            <p className="max-w-[80%] text-[3cqw] leading-snug text-white/45">Describe it in plain words. It plans, writes and checks the code.</p>
                        </div>
                    )}

                    <div className={`flex justify-end ${present(t, SENT)}`}>
                        <div className="max-w-[86%] rounded-[3.4cqw] border border-white/10 bg-[#222] px-[3.4cqw] py-[2.2cqw] text-[3.6cqw] leading-snug text-white">{PROMPT}</div>
                    </div>

                    <div className={`flex flex-col gap-[1.7cqw] transition-all duration-500 ${present(t, REPLY)} ${shown(t, REPLY)}`}>
                        <div className="flex flex-wrap items-center gap-[1.8cqw]">
                            <Logo size={14} className="size-[4cqw] text-[#d97757]" />
                            <span className="text-[3.6cqw] font-semibold text-white">FreeAgentCoder</span>
                            <span className="flex items-center gap-[1cqw] rounded-full border border-white/10 px-[2cqw] py-[0.5cqw] text-[2.8cqw] text-white/70">
                                <Icon d={SPARK} className="text-[#d97757] !size-[2.8cqw]" /> Build
                            </span>
                            <span className="flex items-center gap-[1cqw] rounded-full border border-white/10 px-[2cqw] py-[0.5cqw] text-[2.8cqw] text-white/70">
                                <Icon d={BOLT} className="!size-[2.8cqw] text-amber-300" /> Deep
                            </span>
                        </div>
                        <span className="w-fit rounded-full border border-white/10 px-[2.2cqw] py-[0.6cqw] text-[2.7cqw] text-white/55">Gemini · gemini-3.8-flash</span>
                        <span className="text-[3cqw] text-white/45">› Thought process</span>

                        <ul className="grid gap-[1.1cqw]">
                            {STEPS.map((step, i) => (
                                <li key={step.file} className={`flex items-center gap-[2cqw] text-[3.1cqw] transition-all duration-500 ${present(t, step.at)} ${shown(t, step.at)}`}>
                                    <Check />
                                    <span className={i === 0 ? 'text-white/80' : 'font-mono text-white/85'}>{i === 0 ? step.file : `Wrote ${step.file}`}</span>
                                    <span className={`ml-auto font-mono text-[2.8cqw] ${i === 0 ? 'text-white/40' : 'text-[#4ade80]'}`}>{step.note}</span>
                                </li>
                            ))}
                        </ul>

                        {/* The site, building up as the files land. */}
                        <div className={`overflow-hidden rounded-[2.4cqw] border border-white/10 bg-[#f4f4f5] text-zinc-900 transition-all duration-500 ${present(t, PREVIEW.frame)} ${shown(t, PREVIEW.frame)}`}>
                            <div className="flex items-center gap-[1.2cqw] border-b border-zinc-200 bg-zinc-100 px-[2.4cqw] py-[1.4cqw]">
                                <span className="size-[1.6cqw] rounded-full bg-zinc-300" />
                                <span className="size-[1.6cqw] rounded-full bg-zinc-300" />
                                <span className="size-[1.6cqw] rounded-full bg-zinc-300" />
                                <span className="ml-[1.6cqw] truncate font-mono text-[2.4cqw] text-zinc-500">Preview · localhost:5173</span>
                            </div>
                            <div className="flex flex-col px-[3.2cqw] py-[2.6cqw]">
                                <div className={`flex items-center justify-between transition-all duration-500 ${shown(t, PREVIEW.nav)}`}>
                                    <span className="text-[2.9cqw] font-bold tracking-tight">alex.dev</span>
                                    <span className="flex gap-[1.8cqw] text-[2.3cqw] text-zinc-500">
                                        <span>Work</span>
                                        <span>About</span>
                                        <span>Contact</span>
                                    </span>
                                </div>
                                <div className="mt-[2.4cqw] flex items-center gap-[2.6cqw]">
                                    <span className={`size-[8cqw] shrink-0 rounded-full bg-[radial-gradient(circle_at_30%_30%,#d4d4d8,#52525b)] transition-all duration-500 ${shown(t, PREVIEW.name)}`} />
                                    <div>
                                        <p className={`text-[4.2cqw] font-bold leading-none tracking-tight transition-all duration-500 ${shown(t, PREVIEW.name)}`}>Hi, I&rsquo;m Alex.</p>
                                        <p className={`mt-[0.8cqw] text-[2.5cqw] text-zinc-500 transition-all duration-500 ${shown(t, PREVIEW.role)}`}>Designer and front-end developer</p>
                                    </div>
                                </div>
                                <span className={`mt-[2.2cqw] w-fit rounded-[1.2cqw] bg-zinc-900 px-[2.2cqw] py-[0.9cqw] text-[2.4cqw] font-medium text-white transition-all duration-500 ${shown(t, PREVIEW.button)}`}>
                                    See my work
                                </span>
                                <div className="mt-[2.6cqw] grid grid-cols-3 gap-[1.6cqw]">
                                    {PREVIEW.cards.map((at, i) => (
                                        <span
                                            key={at}
                                            className={`aspect-[1.7] rounded-[1.4cqw] transition-all duration-500 ${shown(t, at)}`}
                                            style={{ background: ['linear-gradient(135deg,#27272a,#71717a)', 'linear-gradient(135deg,#a1a1aa,#e4e4e7)', 'linear-gradient(135deg,#3f3f46,#18181b)'][i] }}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* The footer of the reply, as the extension shows it. */}
                        <div className="flex items-center gap-[2cqw] border-t border-dashed border-white/10 pt-[2cqw] text-[3cqw]">
                            {done ? (
                                <>
                                    <Check />
                                    <span className="font-semibold text-white">Done</span>
                                    <span className="text-white/45">4 steps · 9s · 6.1K tokens</span>
                                </>
                            ) : (
                                <>
                                    <span className="inline-block size-[3cqw] animate-spin rounded-full border-[0.5cqw] border-white/20" style={{ borderTopColor: ACCENT }} />
                                    <span className="flex-1 text-white/70">Writing the code…</span>
                                    <span className="tabular-nums text-white/40">{seconds}s</span>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* The composer: where the request is typed. */}
                <div className="px-[3.4cqw] pb-[2.4cqw]">
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            build();
                        }}
                        className="rounded-[3cqw] border bg-[#1f1f1f] transition-colors"
                        style={{ borderColor: typing || engaged ? ACCENT : 'rgba(255,255,255,0.12)' }}
                    >
                        {engaged ? (
                            <input
                                autoFocus
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                placeholder="Describe an app, then press Enter"
                                aria-label="Describe what to build"
                                className="block min-h-[9cqw] w-full bg-transparent px-[3cqw] pt-[2.4cqw] text-[3.4cqw] text-white outline-none placeholder:text-white/40"
                            />
                        ) : (
                            <button
                                type="button"
                                disabled={frozen}
                                tabIndex={frozen ? -1 : undefined}
                                onClick={() => setDraft('')}
                                className="block min-h-[9cqw] w-full cursor-text px-[3cqw] pt-[2.4cqw] text-left text-[3.4cqw] leading-snug"
                                aria-label="Try it: describe what to build"
                            >
                                {typed ? (
                                    <span className="text-white">
                                        {typed}
                                        <span className="ml-[0.4cqw] inline-block h-[3.4cqw] w-[0.45cqw] translate-y-[0.5cqw] animate-pulse bg-white" />
                                    </span>
                                ) : (
                                    <span className="text-white/35">Click and type what to build. It really builds it.</span>
                                )}
                            </button>
                        )}
                        <div className="flex items-center gap-[2.4cqw] px-[2.4cqw] pb-[2cqw] pt-[1cqw] text-[2.9cqw] text-white/55">
                            <Icon d={CLIP} />
                            <span className="flex items-center gap-[0.8cqw]">
                                <Icon d={BOLT} className="!size-[3cqw]" /> Auto ⌄
                            </span>
                            <span className="flex items-center gap-[0.8cqw]">
                                <Icon d={SPARK} className="!size-[3cqw]" /> Auto ⌄
                            </span>
                            <button
                                type="submit"
                                aria-label="Build it"
                                disabled={engaged && !draft?.trim()}
                                className="ml-auto flex size-[6.4cqw] items-center justify-center rounded-[1.6cqw] text-white transition-opacity"
                                style={{ background: ACCENT, opacity: typed || draft?.trim() ? 1 : 0.45 }}
                                onClick={(e) => {
                                    if (!engaged) {
                                        e.preventDefault();
                                        setDraft('');
                                    }
                                }}
                            >
                                {going ? (
                                    <span className="inline-block size-[3cqw] animate-spin rounded-full border-[0.5cqw] border-white/30 border-t-white" />
                                ) : (
                                    <Icon d="M8 13V3M3.5 7.5 8 3l4.5 4.5" className="!size-[3.4cqw]" />
                                )}
                            </button>
                        </div>
                    </form>
                    <div className="mt-[1.8cqw] flex items-center gap-[2.4cqw] px-[0.6cqw] text-[2.7cqw] text-white/45">
                        <span className="flex items-center gap-[1cqw]">
                            <span className="size-[1.6cqw] rounded-full bg-[#4ade80]" /> 5 keys active
                        </span>
                        <span>{tokens} tokens today</span>
                        <span className="ml-auto">{engaged ? (going ? 'Opening Fyxable…' : 'Enter builds it, live') : `Context ${done ? '9' : sent ? '7' : '2'}%`}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
