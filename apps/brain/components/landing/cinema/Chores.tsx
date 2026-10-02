'use client';

import { useEffect, useState } from 'react';
import { Logo } from '@/components/Logo';
import { InstallLink } from '@/components/InstallLink';
import { Arrow } from './Hero';

type Mode = 'fyx' | 'fyxable';

interface Slide {
    mode: Mode;
    /** The rotating words in the headline. */
    word: string;
    ask: string;
    /** What it ran (Fyx) or wrote (Fyxable). */
    work: string[];
    result: string;
    /** A Fyx chore done in Fyxable rather than in VS Code. */
    onWeb?: boolean;
}

/** Real requests. Fyx's commands are the ones it really produces. */
const SLIDES: Slide[] = [
    { mode: 'fyxable', word: 'build an app', ask: 'a todo app with a dark theme', work: ['+ src/App.jsx', '+ src/styles.css', '~ package.json'], result: 'Running live in this tab' },
    { mode: 'fyxable', word: 'import a Lovable project', ask: 'import my-shop from GitHub', work: ['Read 42 files', 'React · Supabase · Tailwind'], result: 'Mapped, ready to keep building' },
    { mode: 'fyxable', word: 'keep building, free', ask: 'add a login page', work: ['+ src/Login.jsx', '~ src/App.jsx'], result: 'Done on your own free keys' },
    { mode: 'fyx', word: 'run your project', ask: 'run the website locally', work: ['$ npm --prefix homes run dev'], result: 'Running at http://localhost:5173' },
    { mode: 'fyx', onWeb: true, word: 'add a package', ask: 'install zustand', work: ['~ package.json', '+ "zustand": "latest"'], result: 'Added, no model used' },
    { mode: 'fyx', word: 'zip a folder', ask: 'zip the homes folder', work: ['$ tar -a -c -f homes.zip homes'], result: 'homes.zip · node_modules left out' },
    { mode: 'fyx', word: 'push to git', ask: 'commit with message "fix navbar" and push', work: ['$ git commit -m "fix navbar" && git push'], result: 'Committed and pushed' },
];

const COPY: Record<
    Mode,
    { badge: string; lead: string; tail: string; body: string; can?: string[]; places?: { label: string; items: string }[]; stats?: { value: string; label: string }[] }
> = {
    fyx: {
        badge: 'Fyx model · 0 tokens',
        lead: 'Fyx can',
        tail: 'free, with zero tokens.',
        body: 'Our own model for everyday chores, in VS Code and in Fyxable. It runs no AI, so it is instant, free forever, and your keys stay for real work. Anything complex is handed to the agent.',
        places: [
            { label: 'In VS Code', items: 'Run your project · zip folders · commit and push · install packages · make branches' },
            { label: 'In Fyxable', items: 'Run and stop · add packages · download a zip · export to GitHub · delete files' },
        ],
    },
    fyxable: {
        badge: 'Introducing Fyxable',
        lead: 'Fyxable can',
        tail: 'in your browser.',
        body: 'Our free app builder on the web, a Lovable and Bolt alternative with no credits. Describe an app and watch it build and run in this tab.',
        can: ['Build from a prompt', 'Import from Lovable, Bolt or GitHub', 'Run it live in the tab', 'Export to GitHub'],
        stats: [
            { value: '0', label: 'credits to buy' },
            { value: 'No', label: 'install or sign-up' },
            { value: '6', label: 'free keys, rotating' },
        ],
    },
};

/**
 * Fyx and Fyxable in one card: the line, the numbers, the button and the panel
 * all switch together, so each half reads on its own.
 */
export function Chores() {
    const [index, setIndex] = useState(0);
    const [still, setStill] = useState(false);

    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setStill(true);
            return;
        }
        const timer = window.setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), 3_200);
        return () => window.clearInterval(timer);
    }, [index]);

    const slide = SLIDES[index]!;
    const mode = slide.mode;
    const copy = COPY[mode];
    const web = mode === 'fyxable';
    /** The panel looks like Fyxable for Fyxable, and for Fyx's chores on the web. */
    const browser = web || Boolean(slide.onWeb);

    return (
        <section data-float-from className="bg-[#070708] px-2 pb-2 pt-4 sm:px-3 sm:pb-3 sm:pt-6" aria-labelledby="fyx-title">
            <div data-frame className="fyx-card relative overflow-hidden rounded-[22px] px-6 py-14 text-white sm:rounded-[28px] sm:px-12 sm:py-16">
                <div className="relative grid items-center gap-12 lg:grid-cols-[1.15fr_1fr]">
                    {/* Every slide's text is laid out, unseen, in the same place, so the column is always as tall as the tallest and nothing below it moves as the words change. */}
                    <div className="grid">
                        {SLIDES.map((s, i) => (
                            <div key={i} className="invisible [grid-area:1/1]" aria-hidden inert>
                                <ChoresCopy slide={s} still />
                            </div>
                        ))}
                        <div className="[grid-area:1/1]">
                            <ChoresCopy slide={slide} still={still} onPick={(m) => setIndex(SLIDES.findIndex((s) => s.mode === m))} live />
                        </div>
                    </div>

                    {/* The panel, doing what the line on the left names. */}
                    <div className="mx-auto w-full max-w-[400px] rounded-[18px] border border-white/10 bg-[#181818] text-[#cccccc] shadow-[0_40px_90px_-30px_rgb(0_0_0/0.9)]" aria-hidden>
                        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
                            <Logo size={15} className="text-[#d97757]" />
                            <span className="flex-1 text-[14px] font-semibold text-white">{browser ? 'Fyxable' : 'FreeAgentCoder'}</span>
                            <span className="flex items-center gap-1 rounded-full border border-[#d97757]/40 bg-[#d97757]/10 px-2 py-0.5 text-[11px] font-medium text-[#ffb59a]">
                                {web ? (
                                    <>
                                        <Globe /> In your browser
                                    </>
                                ) : (
                                    <>
                                        <Bolt /> Fyx · 0 tokens
                                    </>
                                )}
                            </span>
                        </div>
                        <div key={slide.ask} className={`flex flex-col gap-3 px-4 py-4 ${still ? '' : 'fyx-panel-in'}`}>
                            <div className="self-end rounded-[12px] border border-white/10 bg-[#222] px-3 py-2 text-[13px] text-white">{slide.ask}</div>
                            <div className="flex items-center gap-1.5 text-[12.5px]">
                                <Logo size={12} className="text-[#d97757]" />
                                <span className="font-semibold text-white">{web ? 'FreeAgentCoder' : 'Fyx'}</span>
                                <span className="text-white/40">{web ? '· on your free Gemini key' : browser ? '· in your browser, no AI model' : '· on your machine, no AI model'}</span>
                            </div>
                            <div className="overflow-hidden rounded-[10px] border border-white/10 bg-[#0f0f0f]">
                                <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5 text-[11px] text-white/45">
                                    <span>{browser ? 'Changes' : 'Command'}</span>
                                    <span className="text-[#4ade80]">{browser ? 'applied' : 'approved'}</span>
                                </div>
                                <div className="px-3 pt-2">
                                    {slide.work.map((line) => (
                                        <p key={line} className="truncate font-mono text-[12px] text-white/85">
                                            {line}
                                        </p>
                                    ))}
                                </div>
                                <p className="px-3 pb-2.5 pt-1 text-[12px] text-[#4ade80]">✓ {slide.result}</p>
                            </div>
                            <div className="flex items-center gap-2 border-t border-dashed border-white/10 pt-2.5 text-[12px]">
                                <span className="text-[#4ade80]">✓</span>
                                <span className="font-semibold text-white">Done</span>
                                <span className="text-white/45">{web ? 'no credits used' : browser ? 'instant · 0 tokens' : '1 step · 0.2 s · 0 tokens'}</span>
                            </div>
                        </div>
                        <div className="px-3 pb-3">
                            <div className="flex items-center gap-2 rounded-[10px] border border-white/10 bg-[#1f1f1f] px-3 py-2 text-[12px] text-white/40">
                                <span className="flex-1">{browser ? 'Describe what to build or change…' : 'Ask FreeAgentCoder to build, fix or explain…'}</span>
                                <span className="flex items-center gap-1 text-[#ffb59a]">{browser ? <Globe /> : <Bolt />}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}


/** The left column for one slide. `live` is the one people see; the others only hold its height. */
function ChoresCopy({ slide, still, onPick, live = false }: { slide: Slide; still: boolean; onPick?: (mode: Mode) => void; live?: boolean }) {
    const mode = slide.mode;
    const copy = COPY[mode];
    const web = mode === 'fyxable';
    return (
        <>
                {/* Two tabs: which product the card is showing, and a way to jump to the other. */}
                <div className="inline-flex rounded-full border border-white/15 bg-black/25 p-1 text-[12.5px] font-medium backdrop-blur" role="tablist">
                    {(['fyxable', 'fyx'] as const).map((m) => (
                        <button
                            key={m}
                            type="button"
                            role="tab"
                            aria-selected={mode === m}
                            onClick={() => onPick?.(m)}
                            className={`flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors ${mode === m ? 'bg-white text-zinc-950' : 'text-white/70 hover:text-white'}`}
                        >
                            {m === 'fyx' ? <Bolt /> : <Globe />} {COPY[m].badge}
                        </button>
                    ))}
                </div>
                <h2 id={live ? 'fyx-title' : undefined} className="cine-display mt-6 text-[clamp(2.2rem,5.4vw,4.2rem)] font-medium leading-[1.02] tracking-[-0.04em]">
                    {copy.lead}{' '}
                    <span key={slide.word} className={`fyx-word inline-block text-[#ffd2bf] ${still ? '' : 'fyx-word-in'}`}>
                        {slide.word}
                    </span>
                    <br />
                    <span className="text-white/55">{copy.tail}</span>
                </h2>
                <p key={`b-${mode}`} className={`mt-5 max-w-md text-[15px] leading-relaxed text-white/70 ${still ? '' : 'fyx-panel-in'}`}>
                    {copy.body}
                </p>
                {copy.can && (
                    <ul key={`c-${mode}`} className={`mt-4 flex max-w-md flex-wrap gap-2 ${still ? '' : 'fyx-panel-in'}`}>
                        {copy.can.map((c) => (
                            <li key={c} className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-[12px] text-white/80">
                                <span className="text-[#4ade80]">✓</span> {c}
                            </li>
                        ))}
                    </ul>
                )}
                {copy.places && (
                    <div key={`p-${mode}`} className={`mt-6 grid max-w-md gap-3 sm:grid-cols-2 ${still ? '' : 'fyx-panel-in'}`}>
                        {copy.places.map((p) => (
                            <div key={p.label} className="rounded-[14px] border border-white/15 bg-white/[0.08] px-3.5 py-3 backdrop-blur">
                                <p className="text-[12px] font-semibold text-[#ffd2bf]">{p.label}</p>
                                <p className="mt-1 text-[12.5px] leading-relaxed text-white/70">{p.items}</p>
                            </div>
                        ))}
                    </div>
                )}
                {copy.stats && (
                <dl key={`s-${mode}`} className={`mt-8 grid max-w-md grid-cols-3 gap-3 ${still ? '' : 'fyx-panel-in'}`}>
                    {copy.stats.map((s) => (
                        <div key={s.label} className="rounded-[14px] border border-white/15 bg-white/[0.08] px-3 py-3 backdrop-blur">
                            <dd className="cine-display text-[1.6rem] font-medium leading-none">{s.value}</dd>
                            <dt className="mt-1.5 text-[11.5px] text-white/60">{s.label}</dt>
                        </div>
                    ))}
                </dl>
                )}
                <div className="mt-8 flex flex-wrap items-center gap-3">
                    {web ? (
                        <a
                            href="/fyxable"
                            className="group inline-flex items-center gap-2 rounded-[12px] bg-white px-5 py-3 text-[14.5px] font-medium text-zinc-950 shadow-[0_14px_40px_-12px_rgb(0_0_0/0.5)] transition-transform hover:scale-[1.03]"
                        >
                            Start building in Fyxable <span className="transition-transform group-hover:translate-x-0.5"><Arrow size={14} /></span>
                        </a>
                    ) : (
                        <InstallLink className="group inline-flex items-center gap-2 rounded-[12px] bg-white px-5 py-3 text-[14.5px] font-medium text-zinc-950 shadow-[0_14px_40px_-12px_rgb(0_0_0/0.5)] transition-transform hover:scale-[1.03]">
                            Get Fyx in VS Code, free <span className="transition-transform group-hover:translate-x-0.5"><Arrow size={14} /></span>
                        </InstallLink>
                    )}
                    {web ? (
                        <span className="text-[13px] text-white/50">Free, in your browser</span>
                    ) : (
                        <a href="/fyxable" className="text-[13px] text-white/60 underline-offset-4 hover:text-white hover:underline">
                            or use it in Fyxable
                        </a>
                    )}
                </div>
        </>
    );
}

function Bolt() {
    return (
        <svg viewBox="0 0 16 16" width={12} height={12} fill="currentColor" aria-hidden>
            <path d="M9 1.5 3.5 9h4L7 14.5 12.5 7h-4L9 1.5Z" />
        </svg>
    );
}

function Globe() {
    return (
        <svg viewBox="0 0 16 16" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <circle cx="8" cy="8" r="6.2" />
            <path d="M1.8 8h12.4M8 1.8c1.8 1.7 2.7 3.8 2.7 6.2S9.8 12.5 8 14.2C6.2 12.5 5.3 10.4 5.3 8S6.2 3.5 8 1.8Z" />
        </svg>
    );
}
