/*
 * Fyxable kit: motion components. Import what you need, e.g.
 *   import { Lines, Reveal, Stagger, WordCycle, Marquee, CountUp, Pinned, ScrollHighlight } from './kit/motion.jsx';
 * Styles live in ./kit/kit.css (import it once, in main.jsx). No dependencies beyond React.
 */
import { Children, cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState } from 'react';

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** True once the element has scrolled into view (and stays true). */
export function useInView(ref, { margin = '0px 0px -12% 0px', once = true } = {}) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced() || typeof IntersectionObserver === 'undefined') return setInView(true);
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        if (once) io.disconnect();
      } else if (!once) setInView(false);
    }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin, once]);
  return inView;
}

/** Fades and rises its content in when it enters the viewport. */
export function Reveal({ as: Tag = 'div', delay = 0, rise = 24, className = '', style, children, ...rest }) {
  const ref = useRef(null);
  const inView = useInView(ref);
  return (
    <Tag ref={ref} className={`k-reveal${inView ? ' is-in' : ''} ${className}`} style={{ '--k-delay': `${delay}ms`, '--k-rise': `${rise}px`, ...style }} {...rest}>
      {children}
    </Tag>
  );
}

/** Reveals each child in turn, `step` ms apart. */
export function Stagger({ as: Tag = 'div', step = 90, delay = 0, className = '', children, ...rest }) {
  const ref = useRef(null);
  const inView = useInView(ref);
  return (
    <Tag ref={ref} className={className} {...rest}>
      {Children.map(children, (child, i) =>
        isValidElement(child)
          ? cloneElement(child, {
              className: `${child.props.className ?? ''} k-reveal${inView ? ' is-in' : ''}`,
              style: { ...child.props.style, '--k-delay': `${delay + i * step}ms` },
            })
          : child,
      )}
    </Tag>
  );
}

/** A headline whose lines rise out of clipped boxes, one after another. `lines` is an array of strings or elements. */
export function Lines({ as: Tag = 'h1', lines, step = 90, delay = 0, className = '', ...rest }) {
  const ref = useRef(null);
  const inView = useInView(ref);
  return (
    <Tag ref={ref} className={`${inView ? 'is-in' : ''} ${className}`} {...rest}>
      {lines.map((line, i) => (
        <span key={i} className="k-line">
          <span style={{ '--k-delay': `${delay + i * step}ms` }}>{line}</span>
        </span>
      ))}
    </Tag>
  );
}

/** Cycles through words in place: the old one blurs up and out, the new one rises in, and the sentence reflows to fit. */
export function WordCycle({ words, interval = 2800, className = '' }) {
  const [i, setI] = useState(0);
  const [out, setOut] = useState(false);
  const [width, setWidth] = useState('auto');
  const measure = useRef(null);
  useEffect(() => {
    if (reduced() || words.length < 2) return;
    let swap;
    const id = setInterval(() => {
      setOut(true);
      swap = setTimeout(() => {
        setI((n) => (n + 1) % words.length);
        setOut(false);
      }, 450);
    }, interval);
    return () => {
      clearInterval(id);
      clearTimeout(swap);
    };
  }, [interval, words.length]);
  useLayoutEffect(() => {
    const el = measure.current?.children[i];
    if (el) setWidth(`${el.getBoundingClientRect().width}px`);
  }, [i, words]);
  return (
    <span className="k-cycle">
      <span ref={measure} className="k-cycle-measure" aria-hidden="true">
        {words.map((word) => <span key={word} className={className}>{word}</span>)}
      </span>
      <span className="k-cycle-box" style={{ width }} aria-live="polite">
        <span key={i} className={`k-cycle-word ${className}`} data-out={out}>{words[i]}</span>
      </span>
    </span>
  );
}

/** An endless band of items. Scrolling speeds it up for a moment; hovering slows it down. */
export function Marquee({ items, duration = 30, reverse = false, gap = '3rem', className = '', itemClassName = '' }) {
  const track = useRef(null);
  useEffect(() => {
    const animation = track.current?.getAnimations?.()[0];
    if (!animation || reduced()) return;
    let lastY = window.scrollY;
    let boost = 0;
    let hovered = false;
    let raf = 0;
    const host = track.current.parentElement;
    const enter = () => (hovered = true);
    const leave = () => (hovered = false);
    host.addEventListener('mouseenter', enter);
    host.addEventListener('mouseleave', leave);
    const tick = () => {
      const v = Math.abs(window.scrollY - lastY);
      lastY = window.scrollY;
      boost += (Math.min(v * 0.15, 4) - boost) * 0.1;
      // playbackRate, not duration: changing the duration mid-run makes the track jump.
      animation.playbackRate = hovered ? 0.2 : 1 + boost;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      host.removeEventListener('mouseenter', enter);
      host.removeEventListener('mouseleave', leave);
    };
  }, []);
  const row = items.map((item, i) => <span key={i} className={`k-marquee-item ${itemClassName}`}>{item}</span>);
  return (
    <div className={`k-marquee ${className}`} data-reverse={reverse} style={{ '--k-duration': `${duration}s`, '--k-gap': gap }}>
      <div ref={track} className="k-marquee-track">
        {row}
        <span aria-hidden="true" style={{ display: 'contents' }}>{row}</span>
      </div>
    </div>
  );
}

/** Counts up to a number when it scrolls into view. `format` turns the number into text. */
export function CountUp({ to, duration = 1600, format = (n) => Math.round(n).toLocaleString(), className = '' }) {
  const ref = useRef(null);
  const inView = useInView(ref);
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!inView) return;
    if (reduced()) return setValue(to);
    let raf = 0;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      setValue(to * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [inView, to, duration]);
  return <span ref={ref} className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>{format(value)}</span>;
}

/**
 * Scroll progress through a section, 0 at its top and 1 at its end, smoothed.
 * The loop runs only while the section is on screen.
 */
export function useScrollProgress(ref, { smooth = 0.14 } = {}) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced()) return setProgress(0.5);
    let current = -1;
    let raf = 0;
    let visible = false;
    const tick = () => {
      const r = el.getBoundingClientRect();
      const goal = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - window.innerHeight)));
      current = current < 0 ? goal : current + (goal - current) * smooth;
      setProgress(current);
      raf = visible ? requestAnimationFrame(tick) : 0;
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !raf) raf = requestAnimationFrame(tick);
    }, { rootMargin: '200px 0px' });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [ref, smooth]);
  return progress;
}

/** Maps part of a progress range to 0..1: span(p, .2, .6) is 0 before .2 and 1 after .6. */
export const span = (p, from, to) => Math.min(1, Math.max(0, (p - from) / (to - from)));
/** Decelerating curve for progress values. */
export const ease = (t) => 1 - Math.pow(1 - t, 3);

/**
 * A pinned scene: the section is `height` tall and its frame sticks to the screen
 * while you scroll through it. `children` is a function of progress (0..1).
 */
export function Pinned({ height = '250vh', className = '', frameClassName = '', children }) {
  const ref = useRef(null);
  const progress = useScrollProgress(ref);
  const still = reduced();
  return (
    <section ref={ref} className={`k-pin ${className}`} style={{ height: still ? 'auto' : height }}>
      <div className={`k-pin-frame ${frameClassName}`} style={still ? { position: 'relative', height: 'auto' } : undefined}>
        {children(progress)}
      </div>
    </section>
  );
}

/** A paragraph whose words light up as it is read. Words containing any of `accent` take the accent colour. */
export function ScrollHighlight({ as: Tag = 'p', text, accent = [], className = '' }) {
  const ref = useRef(null);
  const [lit, setLit] = useState(0);
  const words = text.trim().split(/\s+/);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced()) return setLit(words.length);
    let ticking = false;
    const update = () => {
      ticking = false;
      const r = el.getBoundingClientRect();
      const start = window.innerHeight * 0.8;
      const end = window.innerHeight * 0.3;
      const p = Math.min(1, Math.max(0, (start - r.top) / (start - end + r.height)));
      setLit(Math.round(p * words.length));
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', update);
    update();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', update);
    };
  }, [words.length]);
  return (
    <Tag ref={ref} className={`k-highlight ${className}`}>
      {words.map((word, i) => (
        <span key={i}>
          <span className={`k-w${i < lit ? ' on' : ''}${accent.some((a) => word.toLowerCase().includes(a.toLowerCase())) ? ' accent' : ''}`}>{word}</span>
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </Tag>
  );
}
