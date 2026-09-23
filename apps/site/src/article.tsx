import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Article, Block } from './content-articles';
import { href, links } from './config';
import { BrandBadge, Mark, VsCodeButton } from './ui';
import './styles.css';

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'p':
      return <p>{block.text}</p>;
    case 'h2':
      return <h2>{block.text}</h2>;
    case 'ul':
      return (
        <ul className="checks">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol className="article-steps">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      );
    case 'table':
      return (
        <div className="article-table-wrap">
          <table className="article-table">
            <thead>
              <tr>
                {block.headers.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, index) => (
                    <td key={index}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'callout':
      return <p className="article-callout">{block.text}</p>;
  }
}

function ArticlePage({ article }: { article: Article }) {
  return (
    <>
      <header className="nav">
        <a className="skip" href="#main">
          Skip to content
        </a>
        <div className="wrap nav-row">
          <a className="brand" href={href('/')}>
            <Mark size={20} />
            <span>FreeAgentCoder</span>
          </a>
          <span className="nav-by">
            <BrandBadge compact />
          </span>
          <div className="nav-cta">
            <a className="btn btn-ghost btn-sm nav-github" href={links.github} target="_blank" rel="noopener">
              GitHub
            </a>
            <a className="btn btn-primary btn-sm" href={href('/#install')}>
              Install
            </a>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <article className="article">
          <div className="wrap">
            <p className="article-back">
              <a href={href('/')}>← FreeAgentCoder</a>
            </p>
            <header className="article-head">
              <h1>{article.h1}</h1>
              <p className="lead">{article.dek}</p>
              <p className="article-updated">Updated {article.updated}</p>
            </header>
            <div className="article-body">
              {article.blocks.map((block, index) => (
                <BlockView key={index} block={block} />
              ))}
            </div>
            {article.faq.length > 0 && (
              <section className="article-faq" aria-labelledby="article-faq-title">
                <h2 id="article-faq-title">Frequently asked</h2>
                <div className="faq">
                  {article.faq.map((item) => (
                    <details key={item.q}>
                      <summary>{item.q}</summary>
                      <p>{item.a}</p>
                    </details>
                  ))}
                </div>
              </section>
            )}
            <div className="article-cta">
              <div>
                <h2>Try FreeAgentCoder</h2>
                <p className="lead">Free, open source, and running on API keys you already have.</p>
              </div>
              <VsCodeButton />
            </div>
          </div>
        </article>
      </main>
      <footer className="footer">
        <div className="wrap footer-bottom">
          <p>
            A Kodenza product. <a href={href('/')}>Back to FreeAgentCoder</a>.
          </p>
        </div>
      </footer>
    </>
  );
}

export function mountArticle(article: Article): void {
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <ArticlePage article={article} />
    </StrictMode>,
  );
}
