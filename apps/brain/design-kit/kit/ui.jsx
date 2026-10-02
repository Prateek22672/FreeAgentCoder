/*
 * Fyxable kit: interface pieces. Import what you need, e.g.
 *   import { PillNav, Faq, StatStrip } from './kit/ui.jsx';
 */
import { useEffect, useRef, useState } from 'react';

/**
 * A floating pill navigation that stays readable everywhere: over any section
 * marked data-nav="light" it turns light, elsewhere it is dark. On phones the
 * links fold into a menu button.
 */
export function PillNav({ brand, links = [], cta }) {
  const [light, setLight] = useState(false);
  const [open, setOpen] = useState(false);
  const raf = useRef(0);
  useEffect(() => {
    const check = () => {
      raf.current = 0;
      const y = 36;
      setLight([...document.querySelectorAll('[data-nav="light"]')].some((el) => {
        const r = el.getBoundingClientRect();
        return r.top <= y && r.bottom >= y;
      }));
    };
    const schedule = () => {
      if (!raf.current) raf.current = requestAnimationFrame(check);
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    check();
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(raf.current);
    };
  }, []);
  return (
    <header className="k-nav">
      <nav className={`k-nav-pill${light ? ' light' : ''}${open ? ' open' : ''}`} aria-label="Main">
        <a className="k-nav-brand" href="#top">{brand}</a>
        <span className="k-nav-links">
          {links.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}</a>
          ))}
        </span>
        {links.length > 0 && (
          <button type="button" className="k-nav-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? 'Close' : 'Menu'}
          </button>
        )}
        {cta && <a className="k-nav-cta" href={cta.href}>{cta.label}</a>}
      </nav>
    </header>
  );
}

/** Questions and answers that open smoothly. `items` is [{ q, a }]. */
export function Faq({ items, className = '' }) {
  return (
    <div className={`k-faq ${className}`}>
      {items.map((item) => (
        <details key={item.q}>
          <summary>{item.q}</summary>
          <div className="k-faq-a"><div>{item.a}</div></div>
        </details>
      ))}
    </div>
  );
}

/** A row of figures with hairline dividers. `stats` is [{ value, label }]. */
export function StatStrip({ stats, className = '' }) {
  return (
    <dl className={`k-stats ${className}`} style={{ '--k-cols': stats.length }}>
      {stats.map((stat) => (
        <div key={stat.label}>
          <dd>{stat.value}</dd>
          <dt>{stat.label}</dt>
        </div>
      ))}
    </dl>
  );
}
