'use client';

import { useEffect, useState } from 'react';

/**
 * A headline that types itself out on arrival, line by line, with a caret.
 * Every letter is in the page from the start (only hidden until typed), so
 * the layout never shifts and search engines and screen readers get the
 * whole text. With reduced motion it simply shows.
 */
export function TypedHeadline({ lines, className, lineClassNames = [], speed = 55, startDelay = 350, linePause = 260 }: {
    lines: string[];
    className?: string;
    lineClassNames?: string[];
    /** Milliseconds per letter. */
    speed?: number;
    startDelay?: number;
    linePause?: number;
}) {
    const total = lines.reduce((n, line) => n + line.length, 0);
    const [typed, setTyped] = useState(0);
    const [done, setDone] = useState(false);

    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setTyped(total);
            setDone(true);
            return;
        }
        const ends = lines.map((_, i) => lines.slice(0, i + 1).reduce((n, l) => n + l.length, 0));
        let count = 0;
        let timer = 0;
        const tick = () => {
            count++;
            setTyped(count);
            if (count >= total) {
                timer = window.setTimeout(() => setDone(true), 1600);
                return;
            }
            // A short breath at the end of each line, and a little human unevenness.
            timer = window.setTimeout(tick, ends.includes(count) ? linePause : speed * (0.7 + Math.random() * 0.6));
        };
        // Wait for the splash, when there is one, so the typing is seen.
        const begin = () => (timer = window.setTimeout(tick, startDelay));
        if (document.documentElement.dataset.splash === 'on') window.addEventListener('splash:done', begin, { once: true });
        else begin();
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener('splash:done', begin);
        };
    }, [lines, total, speed, startDelay, linePause]);

    let offset = 0;
    return (
        <h1 className={className} aria-label={lines.join(' ')}>
            {lines.map((line, i) => {
                const start = offset;
                offset += line.length;
                const caretHere = !done && (typed < offset || i === lines.length - 1) && typed >= start;
                return (
                    <span key={i} className={`block ${lineClassNames[i] ?? ''}`} aria-hidden>
                        {Array.from(line).map((char, j) => (
                            <span key={j} style={{ opacity: start + j < typed ? 1 : 0 }}>
                                {char}
                            </span>
                        ))}
                        {caretHere && <span className="typed-caret" style={{ marginLeft: typed === start ? 0 : '0.04em' }} />}
                    </span>
                );
            })}
        </h1>
    );
}
