import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { links, released } from './config';
import { LinkButton, Mark } from './ui';
import './styles.css';

function InstallPage() {
  useEffect(() => {
    if (released) {
      window.location.href = links.vscode;
    }
  }, []);

  return (
    <main className="redirect">
      <Mark size={40} />
      <h1>{released ? 'Opening VS Code…' : 'Launching soon'}</h1>
      <p className="lead">
        {released ? "If VS Code doesn't open, pick one of these." : "FreeAgentCoder isn't on the VS Code Marketplace yet. Check back soon."}
      </p>
      <div className="redirect-actions">
        {released ? (
          <>
            <LinkButton href={links.vscode}>Open in VS Code</LinkButton>
            <LinkButton href={links.marketplace} variant="secondary" external>
              Marketplace page
            </LinkButton>
            <LinkButton href={links.openVsx} variant="secondary" external>
              Cursor · Windsurf
            </LinkButton>
          </>
        ) : (
          <LinkButton href={links.github} variant="secondary" external>
            View on GitHub
          </LinkButton>
        )}
      </div>
      <a href="../">← Back to the website</a>
      <p className="redirect-by">A Kodenza product</p>
    </main>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <InstallPage />
  </StrictMode>,
);
