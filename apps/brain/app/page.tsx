import Link from 'next/link';
import { Icon, type IconName } from '@/components/icons';
import { ProductPreview } from '@/components/landing/ProductPreview';
import { RepoForm } from '@/components/RepoForm';
import { StructuredData, brainApp, extensionApp, faqPage, graph, organization, website } from '@/components/StructuredData';
import { ARTICLES } from '@/lib/articles';
import { SAMPLE, SAMPLE_IMPACT } from '@/lib/sample';

import { MARKETPLACE } from '@/lib/site';

/** Answers to what people actually ask before installing. Shown on the page and given to search engines. */
const FAQ = [
    {
        q: 'Is FreeAgentCoder really free?',
        a: 'Yes. The VS Code extension is free and open source (MIT) with no subscription, and it runs on the free tiers of AI providers, so there is nothing to pay. Project Brain is free for public repositories.',
    },
    {
        q: 'Do I need an API key?',
        a: 'Your first two questions each day are free here, so you can see how it answers your own code before committing. After that you paste your own free key — about a minute, no credit card. In VS Code you bring your own free keys from the start.',
    },
    {
        q: 'Does Project Brain change my repository?',
        a: 'No. It only reads: the source is downloaded, analyzed and held in memory for an hour, and repository code is never executed. Changes are made by the agent in VS Code, on your own copy of the code.',
    },
    {
        q: 'Can I analyze a repository that is not mine?',
        a: 'Yes, any public repository. To change it, fork it on GitHub and clone your fork, or clone it directly to work locally. Your agent edits your copy; nothing is pushed anywhere without you.',
    },
    {
        q: 'Which AI models does it use?',
        a: 'The free tiers of Google Gemini, Groq, Cerebras, Mistral and OpenRouter, with automatic failover when one hits its limit. You can add a paid OpenAI or Anthropic key, but you never have to.',
    },
    {
        q: 'Is it unlimited?',
        a: "No free tier is unlimited, and we will not claim otherwise. FreeAgentCoder adds no limits of its own; keys from several providers raise your daily ceiling, and it warns you before a task would run out.",
    },
    {
        q: 'Where do my API keys live?',
        a: 'In VS Code they are encrypted in Secret Storage on your machine. On this website your key stays in your browser and is sent over HTTPS only to answer your question — it is never stored on our server or logged.',
    },
    {
        q: 'Is this an alternative to Copilot, Cursor or Claude Code?',
        a: 'It covers the same job — an AI that works through coding tasks — without a subscription, inside the VS Code you already use. The guides below compare each one honestly.',
    },
];
const EXAMPLES = ['shadcn-ui/taxonomy', 'fastapi/full-stack-fastapi-template', 'expressjs/express'];

const STEPS: { icon: IconName; title: string; body: string }[] = [
    { icon: 'github', title: 'Connect a repository', body: 'Paste any public GitHub repository. Its source is read in about three seconds — never run, never stored.' },
    { icon: 'layers', title: 'Understand it', body: 'Stack, architecture, dependencies and every file, then ask questions and get answers that cite real lines.' },
    { icon: 'impact', title: 'Plan a change', body: 'Describe what you want to change. See every file it touches and a step-by-step plan, before anyone writes code.' },
    { icon: 'code', title: 'Build it in VS Code', body: 'One click sends the plan to your FreeAgentCoder agent, which edits, runs your checks and shows every change.' },
];

const FEATURES: { icon: IconName; title: string; body: string }[] = [
    { icon: 'ask', title: 'Answers you can check', body: 'Every answer cites files and line ranges from the repository. A path the model invents is flagged, not trusted.' },
    { icon: 'impact', title: 'Impact before code', body: 'Direct hits, files reached through imports, packages involved and a risk level — each labelled detected, inferred or estimated.' },
    { icon: 'search', title: 'Search that ranks code first', body: 'Implementation above tests, docs and examples, by identifiers and words. The same engine the VS Code agent uses.' },
    { icon: 'layers', title: 'Architecture from the code', body: 'Only the layers the repository really has, with the files in each. Nothing drawn that is not there.' },
    { icon: 'plan', title: 'Plans your agent can run', body: 'Scope, data, logic, API, UI, tests, verify — in that order, with the actual files, ready for FreeAgentCoder.' },
    { icon: 'shield', title: 'Private by design', body: 'Read-only. Committed .env files and credentials are never sent to a model. Keys stay on the server.' },
];

const BRAIN = ['Understand it', 'Read the code', 'Search', 'Map the structure', 'See what breaks', 'Write the plan'];
const AGENT = ['Do the work', 'Edit files', 'Fix bugs', 'Run your tests', 'Show every diff', 'Undo in a click'];

export default function Home() {
    return (
        <div className="relative overflow-x-clip bg-bg">
            <StructuredData data={graph([organization, website, extensionApp, brainApp, faqPage(FAQ)])} />
            {/* Nav */}
            <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/80 backdrop-blur">
                <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
                    <Link href="/" className="flex items-center gap-2 font-display text-[15px] font-semibold tracking-tight text-fg">
                        <span className="text-lg text-accent">▣</span> FreeAgentCoder
                    </Link>
                    <nav className="hidden items-center gap-6 text-[14px] text-muted md:flex">
                        <a href="#brain" className="hover:text-fg">
                            Read a repo
                        </a>
                        <a href="#agent" className="hover:text-fg">
                            Why this one
                        </a>
                        <a href="#how" className="hover:text-fg">
                            How it works
                        </a>
                        <a href="https://github.com/Prateek22672/FreeAgentCoder" target="_blank" rel="noreferrer noopener" className="hover:text-fg">
                            GitHub
                        </a>
                    </nav>
                    <a href={MARKETPLACE} target="_blank" rel="noreferrer noopener" className="ml-auto rounded-md bg-fg px-3.5 py-1.5 text-[13.5px] font-semibold text-bg hover:opacity-90">
                        Install extension
                    </a>
                </div>
            </header>

            {/* Hero */}
            <section id="brain" className="relative">
                <div className="grid-fade pointer-events-none absolute inset-0 opacity-60" aria-hidden />
                <div className="glow-warm pointer-events-none absolute inset-x-0 bottom-0 h-[70%]" aria-hidden />
                <div className="relative mx-auto max-w-7xl px-4 pb-20 pt-20 sm:px-6 sm:pt-28">
                    <div className="mx-auto max-w-3xl text-center">
                        <h1 className="font-display">
                            <span className="block text-[13px] font-semibold uppercase tracking-[0.18em] text-accent sm:text-[15px]">Free AI coding agent for VS Code</span>
                            <span className="text-gradient mt-4 block text-[2.6rem] font-semibold leading-[1.05] tracking-tight sm:text-6xl">
                                Understand any codebase,
                                <br />
                                then let AI build it.
                            </span>
                        </h1>
                        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted">
                            Paste any GitHub repository and see how it is built, where things live, and what a change would break. Then hand the plan to a VS Code agent that does the work — free, on your own free API keys.
                        </p>
                    </div>

                    <div className="mx-auto mt-9 max-w-2xl rounded-xl border border-line-strong bg-panel/90 p-3 text-left shadow-2xl backdrop-blur sm:p-4">
                        <RepoForm examples={EXAMPLES} />
                    </div>
                    <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px] text-faint">
                        <span className="flex items-center gap-1.5">
                            <Icon name="shield" size={14} /> Read-only, nothing executed
                        </span>
                        <span className="flex items-center gap-1.5">
                            <Icon name="check" size={14} /> Two free questions a day, then your own free key
                        </span>
                        <span className="flex items-center gap-1.5">
                            <Icon name="code" size={14} /> Works with the free FreeAgentCoder agent
                        </span>
                    </div>

                    <div className="mt-16 sm:mt-20">
                        <ProductPreview />
                    </div>
                </div>
            </section>

            {/* How it works */}
            <section id="how" className="border-t border-line">
                <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
                    <p className="text-[12px] font-semibold uppercase tracking-wider text-accent">How it works</p>
                    <h2 className="mt-2 max-w-2xl font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">From a GitHub link to a verified change.</h2>
                    <ol className="mt-10 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
                        {STEPS.map((step, i) => (
                            <li key={step.title} className="bg-panel p-6">
                                <div className="flex items-center gap-3">
                                    <span className="flex size-9 items-center justify-center rounded-lg border border-line-strong bg-bg text-accent">
                                        <Icon name={step.icon} size={18} />
                                    </span>
                                    <span className="font-mono text-[12px] text-faint">0{i + 1}</span>
                                </div>
                                <h3 className="mt-4 text-[15px] font-semibold text-fg">{step.title}</h3>
                                <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{step.body}</p>
                            </li>
                        ))}
                    </ol>
                </div>
            </section>

            {/* Features */}
            <section className="border-t border-line">
                <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
                    <p className="text-[12px] font-semibold uppercase tracking-wider text-accent">What you get</p>
                    <h2 className="mt-2 max-w-2xl font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">Answers you can check, not just answers.</h2>
                    <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {FEATURES.map((f) => (
                            <div key={f.title} className="rounded-xl border border-line bg-panel p-6 transition-colors hover:border-line-strong">
                                <Icon name={f.icon} size={20} className="text-accent" />
                                <h3 className="mt-4 text-[15px] font-semibold text-fg">{f.title}</h3>
                                <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{f.body}</p>
                            </div>
                        ))}
                    </div>
                    <p className="mt-6 text-[13px] text-faint">
                        Example from the preview: replacing Prisma in {SAMPLE.meta.owner}/{SAMPLE.meta.repo} reaches {SAMPLE_IMPACT.total} files across{' '}
                        {SAMPLE_IMPACT.groups.length} kinds of code — found in under a second, before a single edit.
                    </p>
                </div>
            </section>

            {/* Two halves */}
            <section id="agent" className="border-t border-line">
                <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
                    <p className="text-[12px] font-semibold uppercase tracking-wider text-accent">Why this one</p>
                    <h2 className="mt-2 max-w-3xl font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">Reading a repository is the easy half.</h2>
                    <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted">
                        Tools that write a wiki for a repository explain it and stop there. Assistants that change code want a subscription and run on a model you
                        do not choose. This does both halves — and the part that costs money runs on free keys that belong to you, in the editor you already have.
                    </p>
                    <div className="mt-10 grid items-stretch gap-4 lg:grid-cols-[1fr_auto_1fr]">
                        <div className="rounded-xl border border-line bg-panel p-6">
                            <p className="flex items-center gap-2 text-[15px] font-semibold text-fg">
                                <span className="text-accent">▣</span> Project Brain <span className="text-[12px] font-normal text-faint">· this website</span>
                            </p>
                            <ul className="mt-4 grid grid-cols-2 gap-2 text-[14px] text-muted">
                                {BRAIN.map((item) => (
                                    <li key={item} className="flex items-center gap-2">
                                        <Icon name="check" size={14} className="text-ok" /> {item}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="flex items-center justify-center text-faint" aria-hidden>
                            <div className="flex flex-col items-center gap-1 rounded-lg border border-line-strong bg-bg px-3 py-2 text-[11.5px]">
                                <span>plan</span>
                                <Icon name="arrowRight" size={18} className="rotate-90 text-accent lg:rotate-0" />
                            </div>
                        </div>
                        <div className="rounded-xl border border-line bg-panel p-6">
                            <p className="flex items-center gap-2 text-[15px] font-semibold text-fg">
                                <Icon name="code" size={16} className="text-accent" /> FreeAgentCoder <span className="text-[12px] font-normal text-faint">· in VS Code</span>
                            </p>
                            <ul className="mt-4 grid grid-cols-2 gap-2 text-[14px] text-muted">
                                {AGENT.map((item) => (
                                    <li key={item} className="flex items-center gap-2">
                                        <Icon name="check" size={14} className="text-ok" /> {item}
                                    </li>
                                ))}
                            </ul>
                            <a href={MARKETPLACE} target="_blank" rel="noreferrer noopener" className="mt-6 inline-flex items-center gap-1.5 text-[14px] text-accent hover:underline">
                                Get the free extension <Icon name="arrowRight" size={14} />
                            </a>
                        </div>
                    </div>
                </div>
            </section>

            {/* What we believe about agents working on code. */}
            <section className="relative overflow-hidden border-t border-line">
                <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
                    <p className="text-[12px] font-semibold uppercase tracking-wider text-accent">For developers and teams</p>
                    <h2 className="mt-3 max-w-4xl font-display text-3xl font-semibold leading-tight tracking-tight sm:text-[2.6rem]">
                        <span className="text-fg">Understanding comes first —</span>
                        <br />
                        <span className="text-muted">the change is the easy part.</span>
                    </h2>

                    <div className="relative mt-12 flex justify-center">
                        <div className="aurora pointer-events-none absolute -inset-x-2 -top-16 bottom-[-4rem] opacity-90 mix-blend-screen sm:inset-x-10" aria-hidden />
                        <figure className="relative w-full max-w-4xl rounded-3xl border border-line-strong bg-panel/55 p-8 shadow-2xl backdrop-blur-2xl sm:p-12">
                            <span className="block font-display text-5xl leading-none text-accent" aria-hidden>
                                &ldquo;
                            </span>
                            <blockquote className="mt-6 font-display text-xl font-semibold leading-snug sm:text-[1.7rem]">
                                <span className="text-fg">An agent that edits code nobody understands is a liability.</span>{' '}
                                <span className="text-muted">
                                    One that maps the system first, shows exactly what a change touches, and proves the result against your own tests is a colleague. That is the
                                    difference between an impressive demo and work you can ship on a Friday.
                                </span>
                            </blockquote>
                            <figcaption className="mt-8 text-[13px]">
                                <span className="block font-semibold text-fg">The FreeAgentCoder team</span>
                                <span className="block text-faint">Kodenza</span>
                            </figcaption>
                        </figure>
                    </div>
                </div>
            </section>

            {/* Final CTA */}
            <section className="relative border-t border-line">
                <div className="glow-warm pointer-events-none absolute inset-0 opacity-70" aria-hidden />
                <div className="relative mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
                    <h2 className="font-display text-3xl font-semibold tracking-tight text-fg sm:text-5xl">See your own repository.</h2>
                    <p className="mt-4 text-lg text-muted">Paste a link. In a few seconds you will know how it is built and what a change would touch.</p>
                    <div className="mx-auto mt-8 max-w-xl rounded-xl border border-line-strong bg-panel/90 p-3 text-left backdrop-blur sm:p-4">
                        <RepoForm examples={[]} />
                    </div>
                </div>
            </section>

            {/* FAQ: the questions people ask before installing. */}
            <section id="faq" className="border-t border-line">
                <div className="mx-auto max-w-4xl px-4 py-20 sm:px-6">
                    <p className="text-[12px] font-semibold uppercase tracking-wider text-accent">Questions</p>
                    <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">Straight answers.</h2>
                    <dl className="mt-8 divide-y divide-line rounded-xl border border-line bg-panel px-5">
                        {FAQ.map((item) => (
                            <div key={item.q} className="py-5">
                                <dt className="text-[15px] font-medium text-fg">{item.q}</dt>
                                <dd className="mt-1.5 text-[14.5px] leading-relaxed text-muted">{item.a}</dd>
                            </div>
                        ))}
                    </dl>
                </div>
            </section>

            {/* Guides: one page per real question people search for. */}
            <section className="border-t border-line">
                <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
                    <p className="text-[12px] font-semibold uppercase tracking-wider text-accent">Guides</p>
                    <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">Read before you switch.</h2>
                    <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {ARTICLES.map((article) => (
                            <li key={article.slug}>
                                <Link href={`/${article.slug}`} className="flex h-full flex-col rounded-xl border border-line bg-panel p-5 transition-colors hover:border-accent">
                                    <span className="text-[15px] font-semibold text-fg">{article.h1}</span>
                                    <span className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{article.description}</span>
                                    <span className="mt-3 flex items-center gap-1 text-[13px] text-accent">
                                        Read <Icon name="arrowRight" size={14} />
                                    </span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </div>
            </section>

            <footer className="border-t border-line">
                <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-8 text-[13px] text-faint sm:px-6">
                    <span>A Kodenza product.</span>
                    <span className="flex gap-5">
                        <a href={MARKETPLACE} target="_blank" rel="noreferrer noopener" className="hover:text-fg">
                            VS Code extension
                        </a>
                        <a href="https://github.com/Prateek22672/FreeAgentCoder" target="_blank" rel="noreferrer noopener" className="hover:text-fg">
                            GitHub
                        </a>
                    </span>
                </div>
            </footer>
        </div>
    );
}
