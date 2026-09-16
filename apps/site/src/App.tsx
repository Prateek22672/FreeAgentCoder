import { useEffect, useState } from 'react';
import { KeyCalculator } from './calculator';
import { config, href, installCommand, links, released } from './config';
import { FAQ, KEY_STORAGE, KEYCHAINS, PROVIDERS } from './content';
import { ARTICLES } from './content-articles';
import { Demo } from './demo';
import { FeatureExplorer } from './features';
import { BrandBadge, CopyField, handleTabKeys, LinkButton, LockIcon, Mark, Section, VsCodeButton } from './ui';

const NAV = [
  { href: '#demo', label: 'Demo' },
  { href: '#features', label: 'Features' },
  { href: '#keys', label: 'Keys' },
  { href: '#providers', label: 'Providers' },
  { href: '#privacy', label: 'Privacy' },
  { href: '#faq', label: 'FAQ' },
];

const SPEC = [
  { term: 'Price', value: 'Free. MIT licensed.' },
  { term: 'Free keys', value: 'Gemini, Groq, Cerebras, Mistral, OpenRouter' },
  { term: 'Paid keys', value: 'OpenAI, Anthropic (optional)' },
  { term: 'Editors', value: 'VS Code 1.137+, Cursor, Windsurf, VSCodium' },
  { term: 'Your keys', value: 'On your device, in your OS keychain' },
  { term: 'Telemetry', value: 'None. No account, no server.' },
];

export function App() {
  return (
    <>
      <Header />
      <main id="main" tabIndex={-1}>
        <Hero />

        <Section
          id="demo"
          index="01"
          label="Demo"
          title="Watch it finish a task"
          lead="Plan, read, edit, test, report. Every step shows up in the chat panel as it happens. Jump to any step, or pause and read."
        >
          <Demo />
        </Section>

        <Section id="features" index="02" label="Features" title="A real agent, not a chat box" lead="Pick a feature to see what it does." alt>
          <FeatureExplorer />
        </Section>

        <Section
          id="keys"
          index="03"
          label="Keys calculator"
          title="How many keys do I need?"
          lead="A quick estimate based on how you work. Every assumption is listed, and the per-key allowance is yours to set."
        >
          <KeyCalculator />
        </Section>

        <Section
          id="providers"
          index="04"
          label="Providers"
          title="Free tiers first. Paid keys if you want them."
          lead="Mix keys from any of these providers. Free-tier limits change often, so check each provider’s site for current numbers."
          alt
        >
          <ProvidersTable />
        </Section>

        <Section id="install" index="05" label="Install" title="Install in under a minute" lead="No sign-up and no config files. Open the folder you already work in.">
          <Install />
        </Section>

        <Section id="privacy" index="06" label="Privacy" title="Your keys, your code, your machine" alt>
          <Privacy />
        </Section>

        <Section
          id="about"
          index="07"
          label="Credits"
          title="Built by Imperium × Foliofyx"
          lead="FreeAgentCoder is an Imperium × Foliofyx product, a collaboration between Imperium and Foliofyx."
        >
          <Credits />
        </Section>

        <Section id="faq" index="08" label="FAQ" title="Questions, answered" alt>
          <div className="faq">
            {FAQ.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </Section>

        <FinalCta />
      </main>
      <Footer />
    </>
  );
}

function Header() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        document.getElementById('menu-toggle')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className="nav">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="wrap nav-row">
        <a className="brand" href="#top">
          <Mark size={20} />
          <span>FreeAgentCoder</span>
        </a>
        <span className="nav-by">
          <BrandBadge compact />
        </span>
        <nav className="nav-links" aria-label="Main">
          {NAV.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="nav-cta">
          <a className="btn btn-ghost btn-sm nav-github" href={links.github} target="_blank" rel="noopener">
            GitHub
          </a>
          <a className="btn btn-primary btn-sm" href="#install">
            Install
          </a>
          <button
            id="menu-toggle"
            type="button"
            className="btn btn-ghost btn-sm nav-toggle"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? 'Close' : 'Menu'}
          </button>
        </div>
      </div>
      <nav id="mobile-nav" className="mobile-nav" aria-label="Main" hidden={!open}>
        {NAV.map((item) => (
          <a key={item.href} href={item.href} onClick={() => setOpen(false)}>
            {item.label}
          </a>
        ))}
        <a href="#install" onClick={() => setOpen(false)}>
          Install
        </a>
        <a href={links.github} target="_blank" rel="noopener" onClick={() => setOpen(false)}>
          GitHub <span aria-hidden="true">↗</span>
        </a>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <div className="wrap hero-grid">
        <div className="hero-copy">
          <BrandBadge />
          <p className="label hero-kicker">FreeAgentCoder · Free, open-source · Extension for VS Code</p>
          <h1 id="hero-title">A free AI coding agent for VS Code.</h1>
          <p className="lead hero-lead">
            An open-source AI pair programmer that plans, edits, runs and verifies code in your project using your own free API keys from Gemini, Groq, Cerebras, Mistral and
            OpenRouter, or paid OpenAI and Anthropic keys. No subscription, ever.
          </p>
          <div className="hero-actions">
            <VsCodeButton />
            <LinkButton href={links.github} variant="secondary" size="lg" external>
              View on GitHub
            </LinkButton>
          </div>
          {!released && <p className="soon-line">Launching soon on the VS Code Marketplace and Open VSX.</p>}
          <p className="trust">
            <LockIcon size={20} />
            <span>
              <strong>Your API keys stay on your device.</strong> They are stored encrypted in VS Code's Secret Storage (your operating system's keychain). No account, no
              server, no telemetry. <a href="#privacy">How keys are stored</a>
            </span>
          </p>
        </div>

        <div className="spec">
          <p className="spec-title label">At a glance</p>
          <dl>
            {SPEC.map((row) => (
              <div className="spec-row" key={row.term}>
                <dt>{row.term}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

function ProvidersTable() {
  return (
    <div className="table">
      <table>
        <caption className="sr-only">Supported providers, their plans and what each is good at</caption>
        <thead>
          <tr>
            <th scope="col">Provider</th>
            <th scope="col">Plan</th>
            <th scope="col">Good at</th>
            <th scope="col">Good to know</th>
            <th scope="col">Get a key</th>
          </tr>
        </thead>
        <tbody>
          {PROVIDERS.map((provider) => (
            <tr key={provider.name}>
              <th scope="row" data-label="Provider">
                {provider.name}
              </th>
              <td data-label="Plan">
                <span className={`plan${provider.paid ? ' is-paid' : ''}`}>{provider.plan}</span>
              </td>
              <td data-label="Good at">{provider.goodAt}</td>
              <td data-label="Good to know" className="muted">
                {provider.note}
              </td>
              <td data-label="Get a key">
                {provider.keyUrl ? (
                  <a href={provider.keyUrl} target="_blank" rel="noopener">
                    {provider.keyHost}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <span className="muted">Your provider account</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const INSTALL_TABS = ['VS Code', 'Cursor · Windsurf', '.vsix file'];

function Install() {
  const [tab, setTab] = useState(0);
  return (
    <div className="install-grid">
      <div className="install">
        <div className="tabs" role="tablist" aria-label="Install options">
          {INSTALL_TABS.map((label, index) => (
            <button
              key={label}
              id={`install-tab-${index}`}
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === index}
              aria-controls="install-panel"
              tabIndex={tab === index ? 0 : -1}
              onClick={() => setTab(index)}
              onKeyDown={(event) => handleTabKeys(event, index, INSTALL_TABS.length, 'install', setTab)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="tab-panel" id="install-panel" role="tabpanel" aria-labelledby={`install-tab-${tab}`}>
          {tab === 0 && (
            <>
              <div className="actions">
                <VsCodeButton size="md" label="Open in VS Code" />
                {released && (
                  <a href={links.marketplace} target="_blank" rel="noopener">
                    Marketplace page <span aria-hidden="true">↗</span>
                  </a>
                )}
              </div>
              <CopyField label="Or from a terminal" value={installCommand('code')} disabled={!released} />
            </>
          )}
          {tab === 1 && (
            <>
              <div className="actions">
                <LinkButton href={links.openVsx} size="md" external>
                  Open VSX page
                </LinkButton>
                <span className="hint">Or search “FreeAgentCoder” in the Extensions view.</span>
              </div>
              <CopyField label="Or from a terminal" value={installCommand('cursor')} disabled={!released} />
            </>
          )}
          {tab === 2 && (
            <>
              <div className="actions">
                <LinkButton href={links.releases} size="md" external>
                  Download from GitHub Releases
                </LinkButton>
              </div>
              <p className="hint">In the Extensions view, open the ··· menu and choose Install from VSIX…, or run:</p>
              <CopyField label="Terminal" value={`code --install-extension ${config.extension}-<version>.vsix`} />
            </>
          )}
          <ol className="steps">
            <li>
              <span>Click the FreeAgentCoder icon in the activity bar.</span>
            </li>
            <li>
              <span>
                Open <strong>Settings → API Keys → Add API key</strong> and paste a key. Each key is checked with the provider before it’s saved.
              </span>
            </li>
            <li>
              <span>Open a project folder and ask, for example: “Explain how this project is structured and how to run it.”</span>
            </li>
          </ol>
        </div>
        {!released && <p className="soon-note">Launching soon on the VS Code Marketplace and Open VSX.</p>}
      </div>

      <aside className="install-side" aria-label="Requirements">
        <div className="side-block">
          <p className="label">Requirements</p>
          <ul className="checks checks-sm">
            <li>VS Code 1.137 or newer</li>
            <li>At least one API key</li>
            <li>A project folder open in VS Code</li>
          </ul>
        </div>
        <div className="side-block">
          <p className="label">Free keys</p>
          <ul className="side-links">
            {PROVIDERS.filter((provider) => !provider.paid).map((provider) => (
              <li key={provider.name}>
                <a href={provider.keyUrl} target="_blank" rel="noopener">
                  {provider.name}
                  <span className="sr-only"> API keys (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

const PRIVACY = [
  { title: 'No server, no telemetry', body: 'FreeAgentCoder has no server of its own and collects no telemetry. There’s no account to create.' },
  { title: 'Prompts go straight to your providers', body: 'Your prompts and code are sent directly from your editor, only to the providers whose keys you add.' },
  {
    title: 'Check free-tier data policies',
    body: 'Provider terms apply, and some free tiers may use requests to improve their models. Check a provider’s data policy before working on sensitive code.',
  },
  { title: 'History stays on your computer', body: 'Chat history is saved only if you agree, and only on your computer. Turn it off or delete saved chats any time.' },
  { title: 'Logs stay local', body: 'Errors are logged in Settings → Logs. Copy diagnostics removes API keys, tokens and your username from paths.' },
  { title: 'Open source', body: 'MIT licensed. Read the code that runs in your editor on GitHub.' },
];

function Privacy() {
  return (
    <div className="privacy">
      <article className="privacy-keys" aria-labelledby="keys-storage-title">
        <div>
          <p className="label">
            <LockIcon size={14} /> Where your API keys are stored
          </p>
          <h3 id="keys-storage-title">On your device. Nowhere else.</h3>
          <p className="privacy-quote">{KEY_STORAGE}</p>
        </div>
        <dl className="keychains" aria-label="Operating system keychains used by VS Code Secret Storage">
          {KEYCHAINS.map((item) => (
            <div key={item.os}>
              <dt>{item.os}</dt>
              <dd>{item.store}</dd>
            </div>
          ))}
        </dl>
      </article>
      {PRIVACY.map((item) => (
        <article className="cell" key={item.title}>
          <h3>{item.title}</h3>
          <p>
            {item.body}
            {item.title === 'Open source' && (
              <>
                {' '}
                <a href={links.github} target="_blank" rel="noopener">
                  View the repository<span className="sr-only"> (opens in a new tab)</span>
                </a>
                {' · '}
                <a href={links.keyStorage} target="_blank" rel="noopener">
                  See exactly how keys are stored<span className="sr-only"> (opens in a new tab)</span>
                </a>
              </>
            )}
          </p>
        </article>
      ))}
    </div>
  );
}

function Credits() {
  return (
    <div className="credits">
      <p className="credits-mark" aria-hidden="true">
        Imperium <span>×</span> Foliofyx
      </p>
      <div className="cells cols-3">
        <article className="cell">
          <p className="label">Collaborator</p>
          <h3>Imperium</h3>
          <p>Builds FreeAgentCoder in collaboration with Foliofyx.</p>
        </article>
        <article className="cell">
          <p className="label">Collaborator</p>
          <h3>Foliofyx</h3>
          <p>Builds FreeAgentCoder in collaboration with Imperium.</p>
          <p className="cell-link">
            <a href={links.foliofyx} target="_blank" rel="noopener">
              foliofyx.in<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
        </article>
        <article className="cell">
          <p className="label">Creator</p>
          <h3>{config.creator}</h3>
          <p>
            Created FreeAgentCoder. Marketplace publisher ID: <code>{config.publisher}</code>
          </p>
        </article>
      </div>
      <div className="cells cols-3">
        <article className="cell">
          <p className="label">Something broken?</p>
          <h3>Report an issue</h3>
          <p>Bugs and feature requests are tracked in the open, and the code that fixes them is public.</p>
          <p className="cell-link">
            <a href={links.issues} target="_blank" rel="noopener">
              Open an issue<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
        </article>
        <article className="cell">
          <p className="label">Not sure about something?</p>
          <h3>Ask before you install</h3>
          <p>Questions on the Marketplace Q&amp;A tab are answered, not left sitting there.</p>
          {links.qna ? (
            <p className="cell-link">
              <a href={links.qna} target="_blank" rel="noopener">
                Ask a question<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </p>
          ) : null}
        </article>
        <article className="cell">
          <p className="label">Already using it?</p>
          <h3>Leave a review</h3>
          <p>Reviews are how the next developer decides whether a new extension is worth trusting.</p>
          {links.review ? (
            <p className="cell-link">
              <a href={links.review} target="_blank" rel="noopener">
                Write a review<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </p>
          ) : null}
        </article>
      </div>
    </div>
  );
}

function FinalCta() {
  return (
    <section className="final" aria-labelledby="final-title">
      <div className="wrap">
        <div className="final-box">
          <div>
            <h2 id="final-title">Bring your own free keys. Start building.</h2>
            <p className="lead">Install FreeAgentCoder, add a key, and ask for your next feature.</p>
          </div>
          <div className="final-actions">
            <VsCodeButton />
            <LinkButton href={links.github} variant="secondary" size="lg" external>
              View on GitHub
            </LinkButton>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-top">
          <div className="footer-brand">
            <span className="brand">
              <Mark size={18} /> FreeAgentCoder
            </span>
            <p>A free AI coding agent for VS Code.</p>
            <p className="footer-product">
              An{' '}
              <a href={links.foliofyx} target="_blank" rel="noopener">
                Imperium × Foliofyx
              </a>{' '}
              product.
            </p>
          </div>
          <nav className="footer-cols" aria-label="Footer">
            <div>
              <p className="label">Product</p>
              <ul>
                {NAV.map((item) => (
                  <li key={item.href}>
                    <a href={item.href}>{item.label}</a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="label">Get it</p>
              <ul>
                <li>
                  <a href="#install">Install</a>
                </li>
                <li>
                  <a href={links.github} target="_blank" rel="noopener">
                    GitHub
                  </a>
                </li>
                <li>
                  <a href={links.releases} target="_blank" rel="noopener">
                    Releases
                  </a>
                </li>
                {links.marketplace && (
                  <li>
                    <a href={links.marketplace} target="_blank" rel="noopener">
                      VS Code Marketplace
                    </a>
                  </li>
                )}
                {links.openVsx && (
                  <li>
                    <a href={links.openVsx} target="_blank" rel="noopener">
                      Open VSX
                    </a>
                  </li>
                )}
              </ul>
            </div>
            <div>
              <p className="label">Guides</p>
              <ul>
                {ARTICLES.map((article) => (
                  <li key={article.slug}>
                    <a href={href(`/${article.slug}/`)}>{article.h1}</a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="label">Made by</p>
              <ul>
                <li>Imperium</li>
                <li>
                  <a href={links.foliofyx} target="_blank" rel="noopener">
                    Foliofyx
                  </a>
                </li>
                <li>{config.creator}</li>
              </ul>
            </div>
          </nav>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} FreeAgentCoder · MIT License</span>
          <span>
            Created by {config.creator} · Publisher ID <code>{config.publisher}</code>
          </span>
        </div>
      </div>
    </footer>
  );
}
