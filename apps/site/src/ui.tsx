import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { links, openInVsCode } from './config';

/** The "Relay" mark, same geometry as the extension icon. */
export function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" fillRule="evenodd" d="M3 3h13v4H7v9H3zM21 21H8v-4h9V8h4zM10 10h4v4h-4z" />
    </svg>
  );
}

export function LockIcon({ size = 18 }: { size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" d="M8 10V5h8v5" />
      <path fill="currentColor" fillRule="evenodd" d="M4 10h16v11H4zM11 13.5h2v4h-2z" />
    </svg>
  );
}

interface LinkButtonProps {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  external?: boolean;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/** A link styled as a button. Without an href it renders a disabled "Soon" state instead of a dead link. */
export function LinkButton({ href, children, variant = 'primary', size = 'md', external, onClick }: LinkButtonProps) {
  const className = `btn btn-${variant} btn-${size}`;
  if (!href) {
    return (
      <span className={`${className} is-disabled`} aria-disabled="true" title="Available at launch">
        {children}
        <span className="soon">Soon</span>
      </span>
    );
  }
  return (
    <a className={className} href={href} onClick={onClick} {...(external ? { target: '_blank', rel: 'noopener' } : {})}>
      {children}
      {external && (
        <span className="ext" aria-hidden="true">
          ↗
        </span>
      )}
    </a>
  );
}

/** "Open in VS Code", respecting the published gate and falling back to the Marketplace page. */
export function VsCodeButton({ size = 'lg', label = 'Install in VS Code' }: { size?: 'sm' | 'md' | 'lg'; label?: string }) {
  return (
    <LinkButton
      href={links.vscode}
      size={size}
      onClick={(event) => {
        event.preventDefault();
        openInVsCode();
      }}
    >
      {label}
    </LinkButton>
  );
}

export function CopyField({ value, label, disabled }: { value: string; label?: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be blocked; select the text so it can be copied by hand.
      const node = codeRef.current;
      const selection = window.getSelection();
      if (node && selection) {
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  };

  return (
    <div className={`copy${disabled ? ' is-disabled' : ''}`}>
      {label && <span className="copy-label">{label}</span>}
      <div className="copy-row">
        <code ref={codeRef} tabIndex={0}>
          {value}
        </code>
        <button type="button" onClick={copy} disabled={disabled} aria-label={`Copy command: ${value}`}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <span className="sr-only" role="status">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </div>
  );
}

interface SectionProps {
  id?: string;
  index: string;
  label: string;
  title: string;
  lead?: ReactNode;
  alt?: boolean;
  children: ReactNode;
}

export function Section({ id, index, label, title, lead, alt, children }: SectionProps) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={`section${alt ? ' alt' : ''}`} id={id} aria-labelledby={headingId}>
      <div className="wrap">
        <header className="section-head">
          <p className="label">
            <span className="index">{index}</span>
            {label}
          </p>
          <h2 id={headingId}>{title}</h2>
          {lead && <p className="lead">{lead}</p>}
        </header>
        {children}
      </div>
    </section>
  );
}

/** The "A Kodenza product" badge. */
export function BrandBadge({ compact }: { compact?: boolean }) {
  return (
    <span className={`brand-badge${compact ? ' is-compact' : ''}`}>
      {!compact && <span className="brand-badge-pre">An</span>}
      <strong>Kodenza</strong>
      {!compact && <span className="brand-badge-post">product</span>}
    </span>
  );
}

/** Tracks the user's reduced-motion preference. */
export function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * Arrow-key navigation for a WAI-ARIA tablist with automatic activation.
 * Tabs must have ids of the form `${idPrefix}-tab-${index}`.
 */
export function handleTabKeys(
  event: KeyboardEvent<HTMLElement>,
  index: number,
  count: number,
  idPrefix: string,
  select: (next: number) => void,
  orientation: 'horizontal' | 'vertical' = 'horizontal',
): void {
  const prev = orientation === 'horizontal' ? ['ArrowLeft'] : ['ArrowUp', 'ArrowLeft'];
  const next = orientation === 'horizontal' ? ['ArrowRight'] : ['ArrowDown', 'ArrowRight'];
  let target: number | null = null;
  if (prev.includes(event.key)) target = (index - 1 + count) % count;
  else if (next.includes(event.key)) target = (index + 1) % count;
  else if (event.key === 'Home') target = 0;
  else if (event.key === 'End') target = count - 1;
  if (target === null) return;
  event.preventDefault();
  select(target);
  document.getElementById(`${idPrefix}-tab-${target}`)?.focus();
}
