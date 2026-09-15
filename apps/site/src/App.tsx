import { useState } from 'react';
import { installCommand, links, openInVsCode, released } from './config';
import { CopyField, LinkButton, Mark, Section } from './ui';

const PROVIDERS = ['Gemini', 'Groq', 'Cerebras', 'Mistral', 'OpenRouter', 'OpenAI', 'Anthropic'];

const FEATURES = [
  {
    title: 'Smart routing',
    body: 'Quick questions and small edits go to the fastest model. Builds, debugging and multi-file work go to the strongest. Choosing costs no extra request.',
  },
  {
    title: 'Every key works',
    body: 'Add several named keys per provider. When one is rate-limited, the next continues the same task, starting with the key used least today.',
  },
  {
    title: 'Honest usage',
    body: 'Tokens and requests per key, per day. Quota shows only the limits providers actually report, with a warning before you run out.',
  },
  {
    title: 'Every step visible',
    body: 'A live plan, grouped file reads, inline diffs, live terminal output, and a list of every file changed when the task is done.',
  },
  {
    title: 'Safe by default',
    body: 'Pick Manual, Auto-edit or Auto. Risky commands always ask, disk-wiping commands are always blocked, and each task can be undone.',
  },
  {
    title: 'Build and ship',
    body: 'Scaffolds new apps, installs dependencies, runs production builds, and prepares deployment config for platforms like Vercel and Docker.',
  },
];

const PROMPTS = [
  'Explain how this project is structured and how to run it',
  'Create an AGENTS.md with the exact commands to build, test and lint this project',
  'Run the tests and fix whatever fails',
  'Add a dark mode toggle to the settings page',
];

const ROUTES = [
  { request: 'What does useAuth do?', tier: 'fast', route: 'Groq · College' },
  { request: 'Rename getUser to fetchUser', tier: 'fast', route: 'Groq · College' },
  { request: 'Debug why checkout fails on Safari', tier: 'deep', route: 'Gemini · Personal' },
  { request: 'Build a dashboard with charts and login', tier: 'deep', route: 'Gemini · Personal → Gemini · College' },
];

const FAQ = [
  {
    q: 'Is it really free?',
    a: 'Yes. The extension is free and open source, and it runs on the free tiers of providers like Gemini, Groq and Cerebras using your own keys. Paid providers such as OpenAI and Anthropic are optional, and are only used automatically if you have no free key.',
  },
  {
    q: 'Which editors does it work in?',
    a: 'VS Code 1.137 or newer. Cursor, Windsurf and VSCodium install it from the Open VSX registry, or from a .vsix file.',
  },
  {
    q: 'Where does my code go?',
    a: 'Only to the model providers whose keys you add, sent directly from your editor. FreeAgentCoder has no server of its own and collects no telemetry.',
  },
  {
    q: 'Will it follow my team’s conventions?',
    a: 'It reads AGENTS.md, CLAUDE.md, .github/copilot-instructions.md or .cursorrules from your project automatically. If you have none, ask it to create an AGENTS.md.',
  },
  {
    q: 'What happens when a key hits its limit?',
    a: 'That key cools down and your next key continues the same task. Settings shows each key’s status, usage and, when the provider reports it, remaining quota.',
  },
  {
    q: 'Can it break my project?',
    a: 'In Manual mode it asks before every change. In every mode, risky commands like deleting files, git push or deploys need your approval, and you can undo the files changed by each task.',
  },
];

type InstallTab = 'vscode' | 'cursor' | 'terminal' | 'vsix';

const INSTALL_TABS: { id: InstallTab; label: string }[] = [
  { id: 'vscode', label: 'VS Code' },
  { id: 'cursor', label: 'Cursor · Windsurf' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'vsix', label: '.vsix file' },
];

export function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Providers />
        <Section id="features" index="01" label="Features" title="A real agent, not a chat box" lead="It explores your project, makes a plan, edits files, runs your build and tests, and fixes what breaks, showing you every step.">
          <div className="cells cols-3">
            {FEATURES.map((feature, i) => (
              <article className="cell" key={feature.title}>
                <span className="cell-num">{String(i + 1).padStart(2, '0')}</span>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </Section>
        <Onboarding />
        <Routing />
        <Section index="04" label="Privacy" title="Your keys, your code, your machine" alt>
          <div className="cells cols-3">
            <article className="cell">
              <h3>Keys stay local</h3>
              <p>Encrypted in VS Code Secret Storage and never displayed again after you save them.</p>
            </article>
            <article className="cell">
              <h3>No middleman</h3>
              <p>Requests go straight from your editor to the providers you add. No account, no telemetry.</p>
            </article>
            <article className="cell">
              <h3>Open source</h3>
              <p>MIT licensed. Read every line of what runs in your editor.</p>
            </article>
          </div>
        </Section>
        <Section id="faq" index="05" label="FAQ" title="Questions, answered">
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

function Nav() {
  return (
    <header className="nav">
      <div className="wrap nav-row">
        <a className="brand" href="#top">
          <Mark /> FreeAgentCoder
        </a>
        <nav className="nav-links" aria-label="Main">
          <a href="#features">Features</a>
          <a href="#start">Get started</a>
          <a href="#routing">Routing</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="nav-cta">
          {links.github && (
            <a className="btn btn-ghost btn-sm" href={links.github} target="_blank" rel="noopener">
              GitHub
            </a>
          )}
          <a className="btn btn-primary btn-sm" href="#install">
            Install
          </a>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="hero" id="top">
      <div className="wrap hero-grid">
        <div>
          <p className="label">Free · Open source · For VS Code</p>
          <h1>The AI coding agent that runs on free models.</h1>
          <p className="lead">
            FreeAgentCoder plans, writes, runs and verifies code inside your editor. Add free API keys from Gemini, Groq or Cerebras, and it switches between them whenever one hits
            its limit.
          </p>
          <InstallBox />
        </div>
        <PanelPreview />
      </div>
    </section>
  );
}

function InstallBox() {
  const [tab, setTab] = useState<InstallTab>('vscode');
  return (
    <div className="install" id="install">
      <div className="tabs" role="tablist" aria-label="Install options">
        {INSTALL_TABS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className="tab" onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="tab-panel" role="tabpanel">
        {tab === 'vscode' && (
          <>
            <LinkButton
              href={links.vscode}
              size="lg"
              onClick={(event) => {
                event.preventDefault();
                openInVsCode();
              }}
            >
              Open in VS Code
            </LinkButton>
            <p className="hint">
              Opens the extension page inside VS Code with an Install button.{' '}
              {released && (
                <a href={links.marketplace} target="_blank" rel="noopener">
                  Marketplace page ↗
                </a>
              )}
            </p>
          </>
        )}
        {tab === 'cursor' && (
          <>
            <LinkButton href={links.openVsx} size="lg" external>
              Open the Open VSX page
            </LinkButton>
            <p className="hint">Or search “FreeAgentCoder” in your editor’s Extensions view.</p>
          </>
        )}
        {tab === 'terminal' && (
          <>
            <CopyField value={installCommand('code')} disabled={!released} />
            <CopyField value={installCommand('cursor')} disabled={!released} />
          </>
        )}
        {tab === 'vsix' && (
          <>
            <LinkButton href={links.releases} size="lg" external>
              Download from GitHub
            </LinkButton>
            <p className="hint">Then in the Extensions view: ··· menu → Install from VSIX…</p>
          </>
        )}
      </div>
      {!released && <p className="soon-note">Launching soon on the VS Code Marketplace and Open VSX.</p>}
    </div>
  );
}

function PanelPreview() {
  return (
    <figure className="panel" aria-label="The FreeAgentCoder panel adding a login page: a four-step plan, a new file with its diff, and a passing production build.">
      <div className="panel-bar">
        <span className="panel-title">
          <Mark size={14} /> FreeAgentCoder
        </span>
        <span className="panel-meta">Auto-edit</span>
      </div>
      <div className="panel-body">
        <div className="p-user">Add a login page with form validation, then run the build</div>
        <div className="p-agent">
          <Mark size={14} /> FreeAgentCoder <span className="p-chip">Deep</span>
          <span className="p-chip">Gemini · Personal</span>
        </div>
        <div className="p-box">
          <div className="p-head">
            <span>Plan</span>
            <span className="muted">3 / 4</span>
          </div>
          <div className="p-progress">
            <span />
          </div>
          <ul className="p-todos">
            <li className="done">Inspect routes and auth setup</li>
            <li className="done">Create the Login page</li>
            <li className="done">Add form validation</li>
            <li className="doing">Run the production build</li>
          </ul>
        </div>
        <div className="p-line">
          <span className="muted">›</span> Explored <span className="muted">6 files, 2 searches</span>
        </div>
        <div className="p-box">
          <div className="p-head">
            <span>
              <span className="muted">Created</span> src/pages/Login.tsx
            </span>
            <span className="mono">
              <span className="add">+48</span> <span className="del">−0</span>
            </span>
          </div>
          <pre className="p-diff">
            <span className="add">
              <i>1</i>+ import {'{ useState }'} from 'react';
            </span>
            <span className="add">
              <i>2</i>+ import {'{ validateEmail }'} from '../lib/validate';
            </span>
            <span className="add">
              <i>3</i>+ export function Login() {'{'}
            </span>
          </pre>
        </div>
        <div className="p-box">
          <div className="p-head mono">
            <span>$ npm run build</span>
            <span className="p-badge">exit 0</span>
          </div>
          <pre className="p-term">✓ 214 modules transformed.{'\n'}✓ built in 2.41s</pre>
        </div>
        <div className="p-done">
          <span className="ok">✓</span> Done <span className="muted">· 9 steps · 48s · 21.3K tokens</span>
        </div>
      </div>
      <div className="p-input">
        <span>Ask FreeAgentCoder to build, fix or explain…</span>
        <span className="p-send">↑</span>
      </div>
    </figure>
  );
}

function Providers() {
  return (
    <section className="providers" aria-label="Supported providers">
      <div className="wrap">
        <p className="label">Works with keys from</p>
        <ul className="provider-list">
          {PROVIDERS.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Onboarding() {
  return (
    <Section id="start" index="02" label="Get started" title="Working in your codebase in two minutes" lead="No sign-up and no config files. Open the folder you already work in." alt>
      <div className="cells cols-4">
        <article className="cell">
          <span className="cell-num">01</span>
          <h3>Install</h3>
          <p>One click from the Marketplace, one command in the terminal, or Open VSX for Cursor and Windsurf.</p>
        </article>
        <article className="cell">
          <span className="cell-num">02</span>
          <h3>Add a free key</h3>
          <p>
            Get one from{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">
              Google AI Studio
            </a>
            ,{' '}
            <a href="https://console.groq.com/keys" target="_blank" rel="noopener">
              Groq
            </a>{' '}
            or{' '}
            <a href="https://cloud.cerebras.ai" target="_blank" rel="noopener">
              Cerebras
            </a>
            . It’s verified, then encrypted locally.
          </p>
        </article>
        <article className="cell">
          <span className="cell-num">03</span>
          <h3>Open your project</h3>
          <p>It picks up your AGENTS.md, CLAUDE.md, Copilot instructions or .cursorrules, so your conventions carry over.</p>
        </article>
        <article className="cell">
          <span className="cell-num">04</span>
          <h3>Ask</h3>
          <p>Follow the live plan, approve risky steps, and undo any task’s changes with one click.</p>
        </article>
      </div>
      <div className="prompts">
        <p className="label">First prompts to try</p>
        {PROMPTS.map((prompt) => (
          <CopyField key={prompt} value={prompt} />
        ))}
      </div>
    </Section>
  );
}

function Routing() {
  return (
    <Section
      id="routing"
      index="03"
      label="Smart routing"
      title="The right model for every request"
      lead="Each request gets a route. If a key runs out mid-task, the next one continues without redoing work that's already done."
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Request</th>
              <th>Tier</th>
              <th>Keys used</th>
            </tr>
          </thead>
          <tbody>
            {ROUTES.map((row) => (
              <tr key={row.request}>
                <td>“{row.request}”</td>
                <td>
                  <span className={`tier ${row.tier}`}>{row.tier === 'fast' ? 'Fast' : 'Deep'}</span>
                </td>
                <td className="mono">{row.route}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="checks">
        <li>Free keys first. Paid keys are only used automatically if you have no free ones.</li>
        <li>The least-used key goes first, spreading your daily quota.</li>
        <li>Invalid keys are detected, skipped and flagged in Settings.</li>
      </ul>
    </Section>
  );
}

function FinalCta() {
  return (
    <section className="final">
      <div className="wrap">
        <div className="final-box">
          <div>
            <h2>Stop paying to code with AI.</h2>
            <p className="lead">Install FreeAgentCoder, add a free key, and ship your next feature today.</p>
          </div>
          <div className="final-actions">
            <a className="btn btn-primary btn-lg" href="#install">
              Install
            </a>
            {links.github && (
              <a className="btn btn-secondary btn-lg" href={links.github} target="_blank" rel="noopener">
                Star on GitHub
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-row">
        <span className="brand">
          <Mark size={16} /> FreeAgentCoder
        </span>
        <nav className="footer-links" aria-label="Footer">
          {links.marketplace && (
            <a href={links.marketplace} target="_blank" rel="noopener">
              VS Code Marketplace
            </a>
          )}
          {links.openVsx && (
            <a href={links.openVsx} target="_blank" rel="noopener">
              Open VSX
            </a>
          )}
          {links.github && (
            <a href={links.github} target="_blank" rel="noopener">
              GitHub
            </a>
          )}
        </nav>
        <span>MIT License · © {new Date().getFullYear()}</span>
      </div>
    </footer>
  );
}
