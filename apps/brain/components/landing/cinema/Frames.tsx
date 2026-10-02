'use client';

import { useEffect, useRef, useState } from 'react';
import { InstallLink } from '@/components/InstallLink';

/**
 * Three pieces that make the home page feel like one continuous film:
 *
 * - Splash: a coding agent writes three lines of code, the lines fold into
 *   the two halves of our mark, the mark locks, and the page opens. Once per
 *   visit, about two seconds, skipped for reduced motion.
 * - ScrollFrames: every section marked data-frame arrives in 3D (tilted back,
 *   slightly small and dim) and settles flat as it reaches the screen, then
 *   recedes as it leaves. Pinned scenes are left alone; they have their own.
 * - FloatingStart: from the Fyx frame on, a "Get started" pill zooms up
 *   from the bottom and follows you, stepping aside near the final call to
 *   action and the footer.
 */

const CODE = ['const agent = read(repo);', 'agent.plan(task).build();', 'verify(); // ship it'];

/** Decided once per page load, so a remount (React runs effects twice in development) cannot skip it. */
let splashDecision: boolean | undefined;
/**
 * Shown when someone arrives from outside the site; not when they come from
 * another page of it or go back to it, so it plays once per visit without
 * storing anything.
 */
function shouldSplash(): boolean {
    if (splashDecision !== undefined) return splashDecision;
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    let internal = false;
    try {
        internal = !!document.referrer && new URL(document.referrer).origin === location.origin;
    } catch {}
    splashDecision = !internal && nav?.type !== 'back_forward' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return splashDecision;
}

export function Splash() {
    const [stage, setStage] = useState<'hidden' | 'type' | 'fold' | 'lock' | 'open'>('type');
    const [typed, setTyped] = useState(0);

    useEffect(() => {
        if (!shouldSplash()) {
            setStage('hidden');
            window.dispatchEvent(new Event('splash:done'));
            return;
        }
        document.documentElement.dataset.splash = 'on';
        const total = CODE.join('').length;
        const timers: number[] = [];
        let count = 0;
        const typeNext = () => {
            count = Math.min(total, count + 2);
            setTyped(count);
            if (count < total) timers.push(window.setTimeout(typeNext, 16));
            else timers.push(window.setTimeout(() => setStage('fold'), 220));
        };
        timers.push(window.setTimeout(typeNext, 200));
        return () => timers.forEach(clearTimeout);
    }, []);

    useEffect(() => {
        const next: Partial<Record<typeof stage, [typeof stage, number]>> = { fold: ['lock', 520], lock: ['open', 620] };
        const step = next[stage];
        if (step) {
            const timer = window.setTimeout(() => setStage(step[0]), step[1]);
            return () => clearTimeout(timer);
        }
        if (stage === 'open') {
            const timer = window.setTimeout(() => {
                setStage('hidden');
                delete document.documentElement.dataset.splash;
                window.dispatchEvent(new Event('splash:done'));
            }, 650);
            return () => clearTimeout(timer);
        }
    }, [stage]);

    if (stage === 'hidden') return null;
    let left = typed;
    return (
        <div className={`splash splash-${stage}`} aria-hidden>
            <div className="splash-stage">
                <pre className="splash-code">
                    {CODE.map((line, i) => {
                        const shown = line.slice(0, Math.max(0, left));
                        left -= line.length;
                        return (
                            <span key={i} className="splash-line" style={{ '--i': i } as React.CSSProperties}>
                                <span className="splash-ln">{i + 1}</span>
                                {shown}
                                {shown.length > 0 && shown.length < line.length && <i className="splash-caret" />}
                            </span>
                        );
                    })}
                </pre>
                {/* The mark, in its three parts: the two brackets close in, then the centre locks. */}
                <svg className="splash-mark" viewBox="0 0 24 24" width="120" height="120">
                    <path className="splash-a" d="M3 3h13v4H7v9H3z" />
                    <path className="splash-b" d="M21 21H8v-4h9V8h4z" />
                    <path className="splash-c" d="M10 10h4v4h-4z" />
                </svg>
                <p className="splash-word">FreeAgentCoder</p>
            </div>
        </div>
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
