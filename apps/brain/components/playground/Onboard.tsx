'use client';

import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { Logo } from '@/components/Logo';
import { type Brief, type Goal, GOAL_ORDER, GOALS, suggestGoal } from '@/lib/brief';

/**
 * The short onboarding before the workbench: what the person wants to make,
 * the path that fits (a website, an app, an AI app, improving something, or a
 * quick try), and how it should look. Three screens, no account, and the
 * answers go to the agent as its brief.
 */

export interface Imported {
    name: string;
    files: Record<string, string>;
    left: number;
    map: { stack: string[]; packageManager?: string; layers: { label: string; files: number; examples: string[] }[]; important: string[]; runnable: boolean };
}

/** What Project Brain found, said as the agent's first message about an imported project. */
export function describeImport(r: Imported): string {
    const lines = [`Imported ${r.name}: ${Object.keys(r.files).length} files${r.left ? ` (${r.left} large or generated files left out)` : ''}.`];
    if (r.map.stack.length) lines.push(`Built with ${r.map.stack.join(', ')}${r.map.packageManager ? `, using ${r.map.packageManager}` : ''}.`);
    if (r.map.layers.length) lines.push(`Layers: ${r.map.layers.map((l) => `${l.label} (${l.files} files)`).join(', ')}.`);
    if (r.map.important.length) lines.push(`Start reading at ${r.map.important.slice(0, 4).join(', ')}.`);
    lines.push(r.map.runnable ? 'Press Run to start it here, or tell me what to change.' : 'It has no package.json at the root, so it cannot run in the browser, but I can still change it.');
    return lines.join('\n');
}

const STYLES = ['Minimal', 'Bold', 'Playful', 'Corporate', 'Editorial'];
const THEMES = ['Dark', 'Light'];
const ACCENTS: [string, string][] = [
    ['Terracotta', '#d97757'],
    ['Blue', '#2563eb'],
    ['Green', '#16a34a'],
    ['Violet', '#7c3aed'],
    ['Rose', '#e11d48'],
    ['Amber', '#f59e0b'],
    ['Teal', '#0d9488'],
    ['Ink', '#111111'],
];
const FONTS = ['Let the agent pick', 'Inter', 'Space Grotesk + Inter', 'Playfair Display + Source Sans 3', 'DM Serif Display + DM Sans', 'Sora + Manrope', 'Fraunces + Inter', 'Instrument Serif + Geist'];
const KINDS: Partial<Record<Goal, string[]>> = {
    website: ['Landing page', 'Portfolio', 'Business site', 'Shop', 'Blog', 'Event'],
    app: ['Tracker', 'Dashboard', 'Tool', 'Notes', 'Game', 'Chat'],
    ml: ['Chatbot', 'Classifier', 'Summariser', 'Image describer', 'Recommender'],
};
const SECTIONS = ['Hero', 'Features', 'About', 'How it works', 'Pricing', 'Testimonials', 'FAQ', 'Contact', 'Footer'];
const SCREENS = ['Home', 'List', 'Detail', 'Add or edit', 'Settings', 'Sign in'];
const DEFAULT_PICKS: Partial<Record<Goal, string[]>> = {
    website: ['Hero', 'Features', 'Pricing', 'FAQ', 'Footer'],
    app: ['Home', 'List', 'Detail', 'Add or edit'],
    ml: ['Home', 'Settings'],
};
const GOAL_ICON: Record<Goal, IconName> = { website: 'layers', app: 'package', ml: 'spark', improve: 'impact', try: 'arrowRight' };
const EXAMPLES = ['A portfolio for my photography, dark and minimal', 'A habit tracker that works on my phone', 'A chatbot that answers questions about my notes', 'A landing page for a coffee subscription'];

type Step = 'ask' | 'path' | 'prefs';

const PRIMARY = 'inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-[13.5px] font-semibold text-accent-fg hover:brightness-110 disabled:opacity-50';
const SECONDARY = 'inline-flex h-10 items-center gap-2 rounded-md border border-line-strong px-4 text-[13.5px] font-medium text-fg hover:border-accent';

export function Onboard({ idea: initialIdea, onStart, onImport }: { idea?: string; onStart: (brief: Brief) => void; onImport: (imported: Imported) => void }) {
    const first = suggestGoal(initialIdea ?? '');
    const [step, setStep] = useState<Step>(initialIdea ? 'path' : 'ask');
    const [idea, setIdea] = useState(initialIdea ?? '');
    const [goal, setGoal] = useState<Goal>(first.goal);
    const [why, setWhy] = useState(first.why);
    const [mobile, setMobile] = useState(first.mobile);
    const [kind, setKind] = useState<string>();
    const [style, setStyle] = useState('Minimal');
    const [theme, setTheme] = useState('Dark');
    const [accent, setAccent] = useState('#d97757');
    const [fonts, setFonts] = useState(FONTS[0]!);
    const [picks, setPicks] = useState<string[]>(DEFAULT_PICKS[first.goal] ?? []);
    const [repo, setRepo] = useState('');
    const [importing, setImporting] = useState<{ busy?: boolean; error?: string }>({});
    const importRef = useRef<HTMLInputElement>(null);

    const choose = (g: Goal, reason = '') => {
        setGoal(g);
        setWhy(reason);
        setPicks(DEFAULT_PICKS[g] ?? []);
        setKind(undefined);
        setStep('path');
    };
    const submitIdea = () => {
        const s = suggestGoal(idea);
        setMobile(s.mobile);
        choose(s.goal, s.why);
    };
    const start = (withLook: boolean) => {
        onStart({
            goal,
            idea: idea.trim(),
            mobile,
            ...(withLook ? { kind, style, theme, accent, fonts: fonts === FONTS[0] ? undefined : fonts, sections: picks.length ? picks : undefined } : {}),
        });
    };
    const importRepo = async () => {
        const spec = repo.trim();
        if (!spec) return;
        setImporting({ busy: true });
        try {
            const response = await fetch('/api/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repo: spec }) });
            const data = (await response.json()) as Imported & { error?: string };
            if (!response.ok) throw new Error(data.error ?? 'Could not import that repository.');
            onImport(data);
        } catch (error) {
            setImporting({ error: (error as Error).message });
        }
    };

    const importBox = (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                void importRepo();
            }}
            className="mt-8 rounded-xl border border-line bg-panel p-3"
        >
            <div className="flex gap-2">
                <input
                    ref={importRef}
                    value={repo}
                    onChange={(e) => setRepo(e.target.value)}
                    placeholder="Import from GitHub: owner/repo or a github.com link"
                    aria-label="GitHub repository to import"
                    className="h-11 min-w-0 flex-1 rounded-md bg-transparent px-2 font-mono text-[14px] text-fg outline-none placeholder:font-sans placeholder:text-faint"
                />
                <button type="submit" disabled={importing.busy || !repo.trim()} className="h-11 shrink-0 rounded-md border border-line-strong px-4 text-[14px] font-semibold text-fg hover:border-accent disabled:opacity-50">
                    {importing.busy ? 'Reading…' : 'Import'}
                </button>
            </div>
            <p className="mt-1.5 px-2 text-[12px] text-faint">
                {importing.error ? (
                    <span className="text-bad">{importing.error}</span>
                ) : importing.busy ? (
                    'Reading and mapping the repository with Project Brain, a few seconds…'
                ) : (
                    'Keep building a project made in Lovable, Bolt or v0, or any public repository, for free. It is mapped first, so the agent knows how it is built.'
                )}
            </p>
        </form>
    );

    return (
        <div className="min-h-dvh bg-bg">
            <header className="flex h-14 items-center gap-2 border-b border-line px-4">
                <Link href="/" className="flex items-center gap-2 font-display text-[15px] font-semibold text-fg">
                    <Logo /> Fyxable
                </Link>
                <span className="ml-auto text-[12px] text-faint">by Free Agent Coder · free, no account</span>
            </header>

            <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
                <ol className="flex items-center gap-2 text-[12px] font-medium text-faint" aria-label="Steps">
                    {(['ask', 'path', 'prefs'] as Step[]).map((s, i) => (
                        <li key={s} className={`flex items-center gap-2 ${s === step ? 'text-fg' : ''}`}>
                            <span className={`flex size-5 items-center justify-center rounded-full border text-[11px] ${s === step ? 'border-accent bg-accent text-accent-fg' : 'border-line'}`}>{i + 1}</span>
                            {s === 'ask' ? 'What' : s === 'path' ? 'Path' : 'Look'}
                            {i < 2 && <span className="mx-1 h-px w-6 bg-line" />}
                        </li>
                    ))}
                </ol>

                {step === 'ask' && (
                    <>
                        <h1 className="mt-6 font-display text-[clamp(1.8rem,4vw,2.6rem)] font-semibold leading-tight tracking-tight text-fg">What do you want to make?</h1>
                        <p className="mt-2 text-[15px] text-muted">Say it in a sentence. Fyxable suggests the path: a website, an app, an AI app, or a quick try.</p>
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                submitIdea();
                            }}
                            className="mt-6 rounded-xl border border-line-strong bg-panel p-3 focus-within:border-accent"
                        >
                            <textarea
                                value={idea}
                                onChange={(e) => setIdea(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        e.currentTarget.form?.requestSubmit();
                                    }
                                }}
                                rows={3}
                                placeholder="A portfolio for my photography, a habit tracker for my phone, a chatbot for my notes…"
                                aria-label="What you want to make"
                                className="block w-full resize-none bg-transparent px-2 py-1 text-[16px] leading-relaxed text-fg outline-none placeholder:text-faint"
                            />
                            <div className="flex items-center justify-between pt-2">
                                <span className="px-2 text-[12px] text-faint">Enter to continue</span>
                                <button type="submit" disabled={!idea.trim()} className={PRIMARY}>
                                    Continue <Icon name="arrowRight" size={14} />
                                </button>
                            </div>
                        </form>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {EXAMPLES.map((e) => (
                                <button key={e} type="button" onClick={() => setIdea(e)} className="rounded-full border border-line px-3 py-1 text-[12.5px] text-muted hover:border-accent hover:text-fg">
                                    {e}
                                </button>
                            ))}
                        </div>

                        <p className="mt-10 text-[12px] font-semibold uppercase tracking-wider text-faint">Or pick the path</p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {GOAL_ORDER.map((g) => (
                                <button key={g} type="button" onClick={() => choose(g)} className="rounded-xl border border-line bg-panel p-4 text-left transition-colors hover:border-accent">
                                    <span className="flex items-center gap-2 text-[14px] font-semibold text-fg">
                                        <Icon name={GOAL_ICON[g]} size={15} className="text-accent" />
                                        {GOALS[g].label}
                                    </span>
                                    <span className="mt-1 block text-[12.5px] leading-relaxed text-muted">{GOALS[g].blurb}</span>
                                </button>
                            ))}
                        </div>
                        {importBox}
                    </>
                )}

                {step === 'path' && (
                    <>
                        <button type="button" onClick={() => setStep('ask')} className="mt-6 text-[12.5px] text-muted hover:text-fg">
                            ← Change what you said
                        </button>
                        <p className="mt-4 text-[12px] font-semibold uppercase tracking-wider text-faint">We would go with</p>
                        <h1 className="mt-1 flex items-center gap-3 font-display text-[clamp(1.8rem,4vw,2.6rem)] font-semibold leading-tight tracking-tight text-fg">
                            <Icon name={GOAL_ICON[goal]} size={26} className="text-accent" />
                            {GOALS[goal].label}
                        </h1>
                        {why && <p className="mt-2 text-[14.5px] text-muted">{why}</p>}
                        {idea ? (
                            <blockquote className="mt-4 rounded-lg border border-line bg-panel px-4 py-3 text-[14px] text-fg">“{idea}”</blockquote>
                        ) : (
                            <textarea
                                value={idea}
                                onChange={(e) => setIdea(e.target.value)}
                                rows={2}
                                placeholder={goal === 'try' ? 'Describe it, or leave this empty and talk to the agent' : 'Describe it in a sentence'}
                                aria-label="Describe it"
                                className="mt-4 block w-full resize-none rounded-lg border border-line-strong bg-panel px-4 py-3 text-[14px] text-fg outline-none focus:border-accent placeholder:text-faint"
                            />
                        )}
                        <div className="mt-5 rounded-xl border border-line bg-panel p-4">
                            <p className="text-[12px] font-semibold uppercase tracking-wider text-faint">What you get</p>
                            <p className="mt-1 text-[14px] leading-relaxed text-fg">{GOALS[goal].get}</p>
                            {mobile && goal !== 'ml' && (
                                <p className="mt-3 border-t border-line pt-3 text-[13px] leading-relaxed text-muted">
                                    Phone app: Fyxable builds a web app that opens on any phone and installs from the browser. For a native Android or iOS app, use the Free Agent Coder extension in VS Code.
                                </p>
                            )}
                            {goal === 'ml' && (
                                <p className="mt-3 border-t border-line pt-3 text-[13px] leading-relaxed text-muted">
                                    Training a model needs Python and your machine, so that is the VS Code extension. Here you build the app around a model: it calls Gemini with a free key.
                                </p>
                            )}
                        </div>
                        <div className="mt-4 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                            Not it?
                            {GOAL_ORDER.filter((g) => g !== goal).map((g) => (
                                <button key={g} type="button" onClick={() => choose(g)} className="rounded-full border border-line px-3 py-1 hover:border-accent hover:text-fg">
                                    {GOALS[g].label}
                                </button>
                            ))}
                        </div>
                        <div className="mt-8 flex flex-wrap gap-3">
                            {goal === 'try' || goal === 'improve' ? (
                                <button type="button" onClick={() => start(false)} disabled={goal === 'improve' && !idea.trim()} className={PRIMARY}>
                                    {goal === 'try' ? 'Start building' : 'Review and build'} <Icon name="arrowRight" size={14} />
                                </button>
                            ) : (
                                <button type="button" onClick={() => setStep('prefs')} className={PRIMARY}>
                                    Choose the look <Icon name="arrowRight" size={14} />
                                </button>
                            )}
                            {goal === 'improve' && (
                                <button type="button" onClick={() => importRef.current?.focus()} className={SECONDARY}>
                                    <Icon name="github" size={14} /> Import from GitHub
                                </button>
                            )}
                            {goal === 'ml' && (
                                <Link href="/guides" className={SECONDARY}>
                                    Python and training: VS Code
                                </Link>
                            )}
                        </div>
                        {goal === 'improve' && importBox}
                    </>
                )}

                {step === 'prefs' && (
                    <>
                        <button type="button" onClick={() => setStep('path')} className="mt-6 text-[12.5px] text-muted hover:text-fg">
                            ← Back
                        </button>
                        <h1 className="mt-4 font-display text-[clamp(1.8rem,4vw,2.6rem)] font-semibold leading-tight tracking-tight text-fg">How should it look?</h1>
                        <p className="mt-2 text-[15px] text-muted">Pick what you know; the agent fills in the rest. Everything can change by chat later.</p>
                        {KINDS[goal] && (
                            <Field label={goal === 'website' ? 'What kind of site' : 'What kind'}>
                                <Chips options={KINDS[goal]!} value={kind} onPick={(v) => setKind(v === kind ? undefined : v)} />
                            </Field>
                        )}
                        <Field label="Style">
                            <Chips options={STYLES} value={style} onPick={setStyle} />
                        </Field>
                        <Field label="Theme">
                            <Chips options={THEMES} value={theme} onPick={setTheme} />
                        </Field>
                        <Field label="Accent colour">
                            <div className="flex flex-wrap items-center gap-2">
                                {ACCENTS.map(([name, hex]) => (
                                    <button
                                        key={hex}
                                        type="button"
                                        title={name}
                                        aria-label={name}
                                        aria-pressed={accent === hex}
                                        onClick={() => setAccent(hex)}
                                        className={`size-8 rounded-full border-2 transition-transform hover:scale-110 ${accent === hex ? 'border-fg' : 'border-transparent'}`}
                                        style={{ background: hex }}
                                    />
                                ))}
                                <label className="ml-1 flex items-center gap-2 text-[12.5px] text-muted">
                                    Custom
                                    <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} aria-label="Custom accent colour" className="size-8 cursor-pointer rounded-md border border-line bg-transparent" />
                                </label>
                            </div>
                        </Field>
                        <Field label="Fonts">
                            <Chips options={FONTS} value={fonts} onPick={setFonts} />
                        </Field>
                        {goal !== 'ml' && (
                            <Field label={goal === 'website' ? 'Sections' : 'Screens'}>
                                <Chips options={goal === 'website' ? SECTIONS : SCREENS} value={picks} onPick={(v) => setPicks((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]))} />
                            </Field>
                        )}
                        <div className="mt-8 flex flex-wrap items-center gap-4">
                            <button type="button" onClick={() => start(true)} className={PRIMARY}>
                                Build it <Icon name="arrowRight" size={14} />
                            </button>
                            <button type="button" onClick={() => start(false)} className="text-[13px] text-muted hover:text-fg">
                                Skip, let the agent ask me
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="mt-6">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-faint">{label}</p>
            <div className="mt-2">{children}</div>
        </div>
    );
}

/** Pills to pick one of, or several when `value` is a list. */
function Chips({ options, value, onPick }: { options: string[]; value?: string | string[]; onPick: (value: string) => void }) {
    const on = (o: string) => (Array.isArray(value) ? value.includes(o) : value === o);
    return (
        <div className="flex flex-wrap gap-2">
            {options.map((o) => (
                <button
                    key={o}
                    type="button"
                    aria-pressed={on(o)}
                    onClick={() => onPick(o)}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors ${on(o) ? 'border-fg bg-fg text-bg' : 'border-line text-muted hover:border-accent hover:text-fg'}`}
                >
                    {Array.isArray(value) && on(o) && <Icon name="check" size={12} />}
                    {o}
                </button>
            ))}
        </div>
    );
}
