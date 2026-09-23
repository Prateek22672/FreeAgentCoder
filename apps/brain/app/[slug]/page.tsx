import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StructuredData, faqPage, graph, organization, website } from '@/components/StructuredData';
import { Icon } from '@/components/icons';
import { ARTICLES, articleBySlug, type Block } from '@/lib/articles';
import { MARKETPLACE, SITE_URL, canonical } from '@/lib/site';

type Params = Promise<{ slug: string }>;

export const dynamicParams = false;

export function generateStaticParams() {
    return ARTICLES.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
    const { slug } = await params;
    const article = articleBySlug(slug);
    if (!article) return {};
    const url = canonical(`/${article.slug}`);
    return {
        title: article.title,
        description: article.description,
        alternates: { canonical: `/${article.slug}` },
        openGraph: { type: 'article', title: article.title, description: article.description, url, modifiedTime: article.updated },
        twitter: { card: 'summary_large_image', title: article.title, description: article.description },
    };
}

function Content({ block }: { block: Block }) {
    switch (block.type) {
        case 'p':
            return <p className="mt-4 text-[15px] leading-relaxed text-muted">{block.text}</p>;
        case 'h2':
            return <h2 className="mt-10 font-display text-xl font-semibold tracking-tight text-fg">{block.text}</h2>;
        case 'ul':
            return (
                <ul className="mt-4 space-y-2">
                    {block.items.map((item) => (
                        <li key={item} className="flex gap-2.5 text-[15px] leading-relaxed text-muted">
                            <Icon name="check" size={15} className="mt-1 shrink-0 text-accent" />
                            <span>{item}</span>
                        </li>
                    ))}
                </ul>
            );
        case 'ol':
            return (
                <ol className="mt-4 space-y-2">
                    {block.items.map((item, i) => (
                        <li key={item} className="flex gap-3 text-[15px] leading-relaxed text-muted">
                            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong font-mono text-[11px] text-faint">{i + 1}</span>
                            <span>{item}</span>
                        </li>
                    ))}
                </ol>
            );
        case 'table':
            return (
                <div className="scroll-thin mt-5 overflow-x-auto rounded-lg border border-line">
                    <table className="w-full text-[14px]">
                        <thead>
                            <tr className="bg-panel text-left">
                                {block.headers.map((h) => (
                                    <th key={h} className="px-3 py-2 font-medium text-fg">
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {block.rows.map((row, i) => (
                                <tr key={i} className="border-t border-line align-top">
                                    {row.map((cell, j) => (
                                        <td key={j} className={j === 0 ? 'px-3 py-2 font-medium text-fg' : 'px-3 py-2 text-muted'}>
                                            {cell}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
        case 'callout':
            return <p className="mt-5 rounded-lg border border-line bg-panel px-4 py-3 text-[14px] leading-relaxed text-muted">{block.text}</p>;
    }
}

export default async function ArticlePage({ params }: { params: Params }) {
    const { slug } = await params;
    const article = articleBySlug(slug);
    if (!article) notFound();
    const others = ARTICLES.filter((a) => a.slug !== article.slug).slice(0, 4);
    const url = canonical(`/${article.slug}`);

    return (
        <main className="mx-auto max-w-3xl px-4 pb-20 sm:px-6">
            <StructuredData
                data={graph([
                    organization,
                    website,
                    {
                        '@type': 'TechArticle',
                        '@id': `${url}#article`,
                        headline: article.h1,
                        description: article.description,
                        dateModified: article.updated,
                        mainEntityOfPage: url,
                        publisher: { '@id': `${SITE_URL}/#organization` },
                        inLanguage: 'en',
                    },
                    faqPage(article.faq, `/${article.slug}`),
                    {
                        '@type': 'BreadcrumbList',
                        itemListElement: [
                            { '@type': 'ListItem', position: 1, name: 'FreeAgentCoder', item: SITE_URL },
                            { '@type': 'ListItem', position: 2, name: article.h1, item: url },
                        ],
                    },
                ])}
            />

            <header className="flex h-14 items-center justify-between">
                <Link href="/" className="flex items-center gap-2 font-display text-[15px] font-semibold text-fg">
                    <span className="text-lg text-accent">▣</span> FreeAgentCoder
                </Link>
                <a href={MARKETPLACE} target="_blank" rel="noreferrer noopener" className="rounded-md bg-fg px-3 py-1.5 text-[13px] font-semibold text-bg hover:opacity-90">
                    Install extension
                </a>
            </header>

            <article className="pt-10">
                <p className="text-[12px] font-semibold uppercase tracking-wider text-accent">Guide</p>
                <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{article.h1}</h1>
                <p className="mt-4 text-lg leading-relaxed text-muted">{article.dek}</p>
                <p className="mt-3 text-[12.5px] text-faint">Updated {new Date(article.updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>

                {article.blocks.map((block, i) => (
                    <Content key={i} block={block} />
                ))}

                <section className="mt-12">
                    <h2 className="font-display text-xl font-semibold tracking-tight text-fg">Questions</h2>
                    <dl className="mt-4 divide-y divide-line rounded-lg border border-line bg-panel px-4">
                        {article.faq.map((item) => (
                            <div key={item.q} className="py-4">
                                <dt className="text-[15px] font-medium text-fg">{item.q}</dt>
                                <dd className="mt-1.5 text-[14.5px] leading-relaxed text-muted">{item.a}</dd>
                            </div>
                        ))}
                    </dl>
                </section>

                <section className="mt-12 rounded-xl border border-accent/40 bg-panel p-6">
                    <h2 className="font-display text-xl font-semibold tracking-tight text-fg">Try it on your own code</h2>
                    <p className="mt-2 text-[15px] text-muted">Paste a GitHub repository to see how it is built, or install the free VS Code extension.</p>
                    <div className="mt-5 flex flex-wrap gap-3">
                        <Link href="/" className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-accent-fg hover:brightness-110">
                            Analyze a repository <Icon name="arrowRight" size={15} />
                        </Link>
                        <a href={MARKETPLACE} target="_blank" rel="noreferrer noopener" className="inline-flex h-10 items-center gap-2 rounded-md border border-line-strong px-4 text-sm text-fg hover:bg-panel-2">
                            <Icon name="code" size={15} /> Install for VS Code
                        </a>
                    </div>
                </section>

                <nav className="mt-12" aria-label="More guides">
                    <h2 className="text-[12px] font-semibold uppercase tracking-wider text-faint">More guides</h2>
                    <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                        {others.map((other) => (
                            <li key={other.slug}>
                                <Link href={`/${other.slug}`} className="block rounded-lg border border-line bg-panel px-4 py-3 hover:border-accent">
                                    <span className="text-[14px] font-medium text-fg">{other.h1}</span>
                                    <span className="mt-0.5 block text-[13px] text-faint">{other.dek.slice(0, 90)}…</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </nav>
            </article>
        </main>
    );
}
