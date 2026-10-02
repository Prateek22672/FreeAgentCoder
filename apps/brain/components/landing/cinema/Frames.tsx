'use client';

import { useEffect, useRef, useState } from 'react';
import { InstallLink } from '@/components/InstallLink';

/**
 * Three pieces that make the home page feel like one continuous film:
 *
 * - Splash: a coding agent writes three lines of code, the lines fold into
 *   the two halves of our mark, the mark locks, and the page opens. Once per
 *   visit, under five seconds (a click or a key skips it), never with
 *   reduced motion.
 * - ScrollFrames: every section marked data-frame arrives in 3D (tilted back,
 *   slightly small and dim) and settles flat as it reaches the screen, then
 *   recedes as it leaves. Pinned scenes are left alone; they have their own.
 * - FloatingStart: from the Fyx frame on, a "Get started" pill zooms up
 *   from the bottom and follows you, stepping aside near the final call to
 *   action and the footer.
 */

const CODE = ['const agent = read(repo);', 'agent.plan(task).build();', 'verify(); // ship it'];

/**
 * The whole splash is one CSS timeline (seconds from the start), so it plays
 * smoothly even while the page behind it is still loading: every letter,
 * the fold and the lock are compositor animations started by the browser,
 * not by React.
 */
const START = 0.35;
const KEY = 0.028;
const LINE_PAUSE = 0.22;
const TYPED_END = CODE.reduce((t, line) => t + line.length * KEY + LINE_PAUSE, START);
const FOLD = TYPED_END + 0.25;
const LOCK = FOLD + 0.75;
const OPEN = LOCK + 1.0;
const END = OPEN + 0.8;

/**
 * Decided before the first paint by a tiny inline script, so the splash is
 * either there from the very first frame or never drawn at all: shown when
 * someone arrives from outside the site, not when they come from another of
 * its pages or go back to it, and never with reduced motion.
 */
const DECIDE = `(function(){try{var d=document.documentElement,r=document.referrer,n=performance.getEntriesByType('navigation')[0];var inside=r&&new URL(r).origin===location.origin;if(!inside&&!(n&&n.type==='back_forward')&&!matchMedia('(prefers-reduced-motion: reduce)').matches)d.dataset.splash='on';}catch(e){}})();`;

const vars = (v: Record<string, number>) => Object.fromEntries(Object.entries(v).map(([k, n]) => [`--${k}`, `${n.toFixed(3)}s`])) as React.CSSProperties;

export function Splash() {
    const [gone, setGone] = useState(false);

    useEffect(() => {
        const root = document.documentElement;
        if (root.dataset.splash !== 'on') {
            setGone(true);
            window.dispatchEvent(new Event('splash:done'));
            return;
        }
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            delete root.dataset.splash;
            setGone(true);
            window.dispatchEvent(new Event('splash:done'));
        };
        // Click or a key skips straight to the page.
        const skip = () => root.classList.add('splash-skip');
        // The animation began with the first paint, not when this code loaded: end on its clock.
        const timer = window.setTimeout(finish, Math.max(0, END * 1000 - performance.now()));
        const onEnd = (event: AnimationEvent) => event.animationName === 'splash-out' && finish();
        window.addEventListener('pointerdown', skip, { once: true });
        window.addEventListener('keydown', skip, { once: true });
        window.addEventListener('animationend', onEnd);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('pointerdown', skip);
            window.removeEventListener('keydown', skip);
            window.removeEventListener('animationend', onEnd);
        };
    }, []);

    if (gone) return null;
    let t = START;
    return (
        <>
            <script dangerouslySetInnerHTML={{ __html: DECIDE }} />
            <div className="splash" aria-hidden style={vars({ fold: FOLD, lock: LOCK, open: OPEN, end: END })}>
                <div className="splash-glow" />
                <div className="splash-stage">
                    <div className="splash-window">
                        <div className="splash-bar">
                            <i />
                            <i />
                            <i />
                            <span>agent.ts</span>
                        </div>
                        <pre className="splash-code">
                            {CODE.map((line, i) => {
                                const chars = Array.from(line).map((char, j) => {
                                    const at = t;
                                    t += KEY;
                                    const last = i === CODE.length - 1 && j === line.length - 1;
                                    return (
                                        <span key={j} className={last ? 'splash-k splash-k-last' : 'splash-k'} style={vars({ at, next: KEY })}>
                                            {char}
                                        </span>
                                    );
                                });
                                t += LINE_PAUSE;
                                return (
                                    <span key={i} className="splash-line">
                                        <span className="splash-ln">{i + 1}</span>
                                        {chars}
                                    </span>
                                );
                            })}
                        </pre>
                    </div>
                    {/* The mark, in its three parts: the two brackets close in, then the centre locks. */}
                    <svg className="splash-mark" viewBox="0 0 24 24" width="112" height="112">
                        <path className="splash-a" d="M3 3h13v4H7v9H3z" />
                        <path className="splash-b" d="M21 21H8v-4h9V8h4z" />
                        <path className="splash-c" d="M10 10h4v4h-4z" />
                    </svg>
                    <div className="splash-word">
                        <p>FreeAgentCoder</p>
                        <span>reads your code, then builds</span>
                    </div>
                </div>
                <div className="splash-progress" />
            </div>
        </>
    );
}

export function ScrollFrames() {
    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const frames = [...document.querySelectorAll<HTMLElement>('[data-frame]')];
        const state = new Map<HTMLElement, { enter: number; leave: number }>();
        let raf = 0;
        const tick = () => {
            const vh = window.innerHeight;
            let moving = false;
            for (const el of frames) {
                const r = el.getBoundingClientRect();
                if (r.bottom < -vh || r.top > vh * 2) continue;
                // Arriving: from its top entering the screen until it is 35% up the screen.
                const enterGoal = Math.min(1, Math.max(0, (vh - r.top) / (vh * 0.65)));
                // Leaving: as its bottom passes from 40% of the screen to the top.
                const leaveGoal = Math.min(1, Math.max(0, 1 - r.bottom / (vh * 0.4)));
                const s = state.get(el) ?? { enter: enterGoal, leave: leaveGoal };
                s.enter += (enterGoal - s.enter) * 0.16;
                s.leave += (leaveGoal - s.leave) * 0.16;
                if (Math.abs(enterGoal - s.enter) > 0.002 || Math.abs(leaveGoal - s.leave) > 0.002) moving = true;
                state.set(el, s);
                const e = 1 - Math.pow(1 - s.enter, 3);
                const l = s.leave;
                const tilt = (1 - e) * 9 - l * 4;
                const scale = (0.93 + 0.07 * e) * (1 - l * 0.05);
                el.style.transform = `perspective(1600px) translate3d(0, ${(1 - e) * 70 - l * 30}px, 0) rotateX(${tilt.toFixed(2)}deg) scale(${scale.toFixed(4)})`;
                el.style.opacity = String((0.25 + 0.75 * e) * (1 - l * 0.45));
                el.style.transformOrigin = l > 0 ? '50% 100%' : '50% 0%';
            }
            raf = moving ? requestAnimationFrame(tick) : 0;
        };
        const wake = () => {
            if (!raf) raf = requestAnimationFrame(tick);
        };
        for (const el of frames) el.style.willChange = 'transform, opacity';
        window.addEventListener('scroll', wake, { passive: true });
        window.addEventListener('resize', wake);
        wake();
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('scroll', wake);
            window.removeEventListener('resize', wake);
            for (const el of frames) {
                el.style.transform = '';
                el.style.opacity = '';
                el.style.willChange = '';
            }
        };
    }, []);
    return null;
}

export function FloatingStart() {
    const [shown, setShown] = useState(false);
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const cta = document.querySelector('[data-cta]');
        const footer = document.querySelector('footer');
        // It joins at the first section marked data-float-from (the Fyx frame), once that is half way up the screen.
        const from = document.querySelector('[data-float-from]');
        let raf = 0;
        const check = () => {
            raf = 0;
            const vh = window.innerHeight;
            const pastHero = from ? from.getBoundingClientRect().top < vh * 0.5 : window.scrollY > vh * 1.1;
            const nearEnd = [cta, footer].some((el) => {
                const r = el?.getBoundingClientRect();
                return !!r && r.top < vh * 0.85 && r.bottom > 0;
            });
            setShown(pastHero && !nearEnd);
        };
        const schedule = () => {
            if (!raf) raf = requestAnimationFrame(check);
        };
        window.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule);
        check();
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('scroll', schedule);
            window.removeEventListener('resize', schedule);
        };
    }, []);
    useEffect(() => {
        if (!shown) setOpen(false);
    }, [shown]);

    return (
        <div ref={ref} className={`float-start ${shown ? 'is-shown' : ''} ${open ? 'is-open' : ''}`} aria-hidden={!shown}>
            <div className="float-start-card">
                {open && (
                    <div className="float-start-menu">
                        <InstallLink className="float-start-item">
                            <strong>Install for VS Code</strong>
                            <span>Free · one click</span>
                        </InstallLink>
                        <a className="float-start-item" href="/fyxable">
                            <strong>Build in Fyxable</strong>
                            <span>In your browser, no install</span>
                        </a>
                        <a className="float-start-item" href="#brain">
                            <strong>Read a repo</strong>
                            <span>See how any project is built</span>
                        </a>
                    </div>
                )}
                <button type="button" className="float-start-pill" onClick={() => setOpen((v) => !v)} aria-expanded={open} tabIndex={shown ? 0 : -1}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
                        <path fillRule="evenodd" d="M3 3h13v4H7v9H3zM21 21H8v-4h9V8h4zM10 10h4v4h-4z" />
                    </svg>
                    {open ? 'Close' : 'Get started free'}
                    <span className="float-start-arrow" aria-hidden>
                        {open ? '×' : '↑'}
                    </span>
                </button>
            </div>
        </div>
    );
}
