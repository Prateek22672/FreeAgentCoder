import { Logo } from '@/components/Logo';
import type { IconName } from '@/components/icons';
import { Beyond } from '@/components/landing/cinema/Beyond';
import { Carousel } from '@/components/landing/cinema/Carousel';
import { ChromeStar } from '@/components/landing/cinema/ChromeStar';
import { Arrow, Hero, Star } from '@/components/landing/cinema/Hero';
import { Chores } from '@/components/landing/cinema/Chores';
import { marketplaceStats } from '@/lib/marketplace';
import { PillNav } from '@/components/landing/cinema/PillNav';
import { PanelFlight } from '@/components/landing/cinema/PanelFlight';
import { RepoForm } from '@/components/RepoForm';
import { RepoPreview } from '@/components/landing/cinema/RepoPreview';
import { StructuredData, brainApp, extensionApp, faqPage, graph, organization, website } from '@/components/StructuredData';
import { ARTICLES } from '@/lib/articles';
import { InstallLink } from '@/components/InstallLink';
import { GITHUB, MARKETPLACE, VSCODE_INSTALL } from '@/lib/site';

/** Answers to what people actually ask before installing. Shown on the page and given to search engines. */
const FAQ = [
    {
        q: 'Is FreeAgentCoder really free?',
        a: 'Yes. The VS Code extension is free and open source (MIT) with no subscription, and it runs on the free tiers of AI providers, so there is nothing to pay. Project Brain is free for public repositories.',
    },
    {
        q: 'Do I need an API key?',
        a: 'Your first five requests each day are free here, so you can see how it works on your own code before committing. After that you paste your own free key — about a minute, no credit card. In VS Code, a free trial runs your first tasks with no key, then you add your own.',
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
        a: 'The free tiers of Google Gemini, Groq, Mistral and OpenRouter, with automatic failover when one hits its limit. Cohere’s free trial key works in VS Code too, for personal, non-commercial use. Cerebras now needs a card, so it is listed as paid. You can add a paid OpenAI or Anthropic key, but you never have to.',
    },
    {
        q: 'Is it unlimited?',
        a: 'No free tier is unlimited, and we will not claim otherwise. FreeAgentCoder adds no limits of its own; keys from several providers raise your daily ceiling, and it warns you before a task would run out.',
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
const EXAMPLES = ['expressjs/express', 'vercel/swr', 'shadcn-ui/taxonomy'];

const STEPS: { icon: IconName; title: string; body: string }[] = [
    { icon: 'github', title: 'Connect a repository', body: 'Paste any public GitHub repository. Its source is read in about three seconds, never run, never stored.' },
    { icon: 'layers', title: 'Understand it', body: 'Stack, architecture, dependencies and every file, then answers that cite real lines.' },
    { icon: 'impact', title: 'Plan a change', body: 'Every file a change touches and a step-by-step plan, before anyone writes code.' },
    { icon: 'code', title: 'Build it in VS Code', body: 'One click sends the plan to the agent, which edits, runs your checks and shows every change.' },
];


const FOOTER: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
    {
        title: 'Product',
        links: [
            { label: 'Playground', href: '/playground' },
            { label: 'Read a repo', href: '#brain' },
            { label: 'Install in VS Code', href: VSCODE_INSTALL },
            { label: 'Questions', href: '#faq' },
        ],
    },
    {
        title: 'Guides',
        links: [
            { label: 'Free API limits', href: '/free-ai-api-limits' },
            { label: 'Leave Lovable', href: '/move-off-lovable-keep-building-free' },
            { label: 'VS Code agent', href: '/free-ai-coding-agent-vscode' },
            { label: 'All guides', href: '#guides' },
        ],
    },
    {
        title: 'Resources',
        links: [
            { label: 'GitHub', href: GITHUB, external: true },
            { label: 'Marketplace', href: MARKETPLACE, external: true },
            { label: 'Gemini key', href: '/free-gemini-api-key-vs-code' },
        ],
    },
];

export default async function Home() {
    const market = await marketplaceStats();
    return (
        <div className="relative overflow-x-clip bg-[#efeff2]">
            <StructuredData data={graph([organization, website, extensionApp, brainApp, faqPage(FAQ)])} />
            <PillNav />
            <PanelFlight />
            <main>
                <Hero trust={market ? { installs: market.installs, rating: market.rating, ratings: market.ratings } : undefined} />
                <Carousel />
                <Chores />
                <Beyond />

                {/* The working parts: read a repository, the questions, the guides. */}
                <div className="force-dark overflow-hidden rounded-b-[28px] bg-[#070708]">
                    <section id="brain" className="mx-auto max-w-6xl scroll-mt-24 px-5 pb-24 pt-24 sm:px-8">
                        <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/50">Read a repo</h2>
                        <p className="cine-display mt-5 max-w-3xl text-[clamp(2.2rem,5vw,3.8rem)] font-medium leading-[1.02] tracking-[-0.035em] text-white">
                            See how any repository is built <span className="text-white/40">before you change it.</span>
                        </p>
                        <div className="silver-card mt-10 rounded-[28px] px-4 py-8 sm:px-10 sm:py-12">
                            <div className="mx-auto max-w-3xl">
                                <RepoForm examples={EXAMPLES} />
                            </div>
                            <ol className="mx-auto mt-8 grid max-w-4xl grid-cols-2 gap-x-6 gap-y-3 text-[13.5px] text-zinc-700 md:grid-cols-4">
                                {STEPS.map((step, i) => (
                                    <li key={step.title} className="flex items-center gap-2.5">
                                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 font-mono text-[11px] text-white">{i + 1}</span>
                                        {step.title}
                                    </li>
                                ))}
                            </ol>
                            <div className="mx-auto mt-10 max-w-5xl">
                                <p className="mb-3 text-center text-[12.5px] text-zinc-600">What you get back, in about 3 seconds</p>
                                <RepoPreview />
                            </div>
                        </div>
                    </section>

                    <section id="faq" className="mx-auto max-w-4xl scroll-mt-24 px-5 py-24 sm:px-8">
                        <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/50">Questions</h2>
                        <p className="cine-display mt-5 text-[clamp(2rem,4.5vw,3.2rem)] font-medium tracking-[-0.035em] text-white">Straight answers.</p>
                        <div className="mt-10 divide-y divide-white/10 border-y border-white/10">
                            {FAQ.map((item) => (
                                <details key={item.q} className="faq group py-1">
                                    <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[16px] font-medium text-white">
                                        {item.q}
                                        <span className="text-xl leading-none text-white/40 transition-transform duration-300 group-open:rotate-45" aria-hidden>
                                            +
                                        </span>
                                    </summary>
                                    <p className="pb-6 pr-10 text-[14.5px] leading-relaxed text-white/60">{item.a}</p>
                                </details>
                            ))}
                        </div>
                    </section>

                    <section id="guides" className="mx-auto max-w-4xl scroll-mt-24 px-5 pb-28 pt-6 sm:px-8">
                        <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/50">Guides</h2>
                        <p className="mt-3 text-[15px] text-white/60">Honest answers before you switch, one page each.</p>
                        {/* Plain links on purpose: real page loads, so each guide stays its own indexable page. */}
                        <ul className="mt-6 grid gap-x-8 sm:grid-cols-2">
                            {ARTICLES.map((article) => (
                                <li key={article.slug} className="border-t border-white/10">
                                    <a href={`/${article.slug}`} className="group flex items-center justify-between gap-4 py-3.5 text-[15px] text-white/85 transition-colors hover:text-white">
                                        <span>{article.h1}</span>
                                        <span className="shrink-0 text-white/40 transition-transform group-hover:translate-x-0.5 group-hover:text-white">
                                            <Arrow size={14} />
                                        </span>
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </section>
                </div>

                {/* The last call to action. */}
                <section className="p-2 pt-16 sm:p-3 sm:pt-24" aria-labelledby="cta-title">
                    <div className="cine-graphite relative grid min-h-[min(100dvh,760px)] overflow-hidden rounded-[22px] sm:rounded-[28px] md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                        <div className="relative z-10 flex flex-col justify-center px-6 py-20 text-white sm:px-12">
                            <h2 id="cta-title" className="cine-display text-[clamp(3rem,7vw,5.6rem)] font-semibold leading-[0.95] tracking-[-0.035em]">
                                Start
                                <br />
                                building
                                <br />
                                <span className="text-white/50">
                                    for
                                    <br />
                                    free.
                                </span>
                            </h2>
                            <p className="mt-7 max-w-[19rem] text-[15px] leading-relaxed text-white/80">
                                A playground in your browser and an agent in your editor, both on keys you own. Ship something today.
                            </p>
                            <a
                                href="/playground"
                                className="group mt-8 inline-flex w-fit items-center gap-2 rounded-[12px] bg-white px-5 py-3 text-[14.5px] font-medium text-zinc-950 shadow-[0_14px_40px_-12px_rgb(0_0_0/0.5)] transition-transform hover:scale-[1.03]"
                            >
                                Get started <span className="transition-transform group-hover:translate-x-0.5"><Arrow size={14} /></span>
                            </a>
                            <p className="mt-7 max-w-[17rem] text-[14px] leading-relaxed text-white/75">
                                No card required · No sign-up ·{' '}
                                <InstallLink className="underline decoration-white/40 underline-offset-4 hover:decoration-white">or install in VS Code</InstallLink>
                            </p>
                        </div>
                        <ChromeStar className="pointer-events-none absolute inset-y-0 right-[-10%] h-full w-[80%] opacity-60 md:relative md:right-0 md:w-full md:opacity-100" />
                    </div>
                </section>
            </main>

            <footer data-nav="light" className="px-5 pb-8 pt-20 text-zinc-900 sm:px-12">
                <div className="flex flex-col gap-14 md:flex-row md:items-start md:justify-between">
                    <div>
                        <Star size={22} className="text-zinc-900" />
                        <p className="cine-display mt-3 text-[clamp(2.6rem,8vw,6.2rem)] font-medium leading-none tracking-[-0.055em]">FreeAgentCoder</p>
                        <p className="mt-3 text-[14px] text-zinc-500">Your codebase has a brain.</p>
                    </div>
                    <nav aria-label="Footer" className="grid shrink-0 grid-cols-2 gap-x-10 gap-y-10 whitespace-nowrap pt-2 sm:grid-cols-3">
                        {FOOTER.map((col) => (
                            <div key={col.title}>
                                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">{col.title}</p>
                                <ul className="mt-4 space-y-2.5 text-[14.5px]">
                                    {col.links.map((link) => (
                                        <li key={link.label}>
                                            {link.href === VSCODE_INSTALL ? (
                                                <InstallLink className="hover:text-zinc-500">{link.label}</InstallLink>
                                            ) : (
                                                <a href={link.href} {...(link.external ? { target: '_blank', rel: 'noreferrer noopener' } : {})} className="hover:text-zinc-500">
                                                    {link.label}
                                                </a>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </nav>
                </div>
                <div className="mt-20 flex flex-col gap-3 border-t border-zinc-300 pt-6 text-[13px] text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
                    <span className="flex items-center gap-2">
                        <Logo size={13} className="text-zinc-700" /> © 2026 FreeAgentCoder · A Codeloft product
                    </span>
                    <span>Free and open source · Works with Claude, GPT, Gemini and more, on your own keys.</span>
                </div>
            </footer>
        </div>
    );
}
