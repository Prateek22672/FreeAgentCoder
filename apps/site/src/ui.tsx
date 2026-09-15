import { useState, type MouseEvent, type ReactNode } from 'react';

export function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" fillRule="evenodd" d="M2 2h9v3H5v6H2zM14 14H5v-3h6V5h3zM7 7h2v2H7z" />
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
    </a>
  );
}

export function CopyField({ value, disabled }: { value: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be blocked; the text stays selectable.
    }
  };
  return (
    <div className={`copy${disabled ? ' is-disabled' : ''}`}>
      <code>{value}</code>
      <button type="button" onClick={copy} disabled={disabled} aria-label={`Copy: ${value}`}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

interface SectionProps {
  id?: string;
  index: string;
  label: string;
  title: string;
  lead?: string;
  alt?: boolean;
  children: ReactNode;
}

export function Section({ id, index, label, title, lead, alt, children }: SectionProps) {
  return (
    <section className={`section${alt ? ' alt' : ''}`} id={id}>
      <div className="wrap">
        <header className="section-head">
          <p className="label">
            <span className="index">{index}</span>
            {label}
          </p>
          <h2>{title}</h2>
          {lead && <p className="lead">{lead}</p>}
        </header>
        {children}
      </div>
    </section>
  );
}
