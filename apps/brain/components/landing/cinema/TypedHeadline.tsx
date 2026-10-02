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
    const [started, setStarted] = useState(false);
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
        const begin = () => {
            setStarted(true);
            timer = window.setTimeout(tick, startDelay);
        };
        if (document.documentElement.dataset.splash === 'on') window.addEventListener('splash:done', begin, { once: true });
        else begin();
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener('splash:done', begin);
        };
    }, [lines, total, speed, startDelay, linePause]);

    // The caret sits on the line being typed, right after its newest letter; letters not yet typed keep their place, unseen.
    const caretLine = started && !done ? lines.findIndex((_, i) => typed < lines.slice(0, i + 1).reduce((n, l) => n + l.length, 0) || i === lines.length - 1) : -1;
    let offset = 0;
    return (
        <h1 className={className} aria-label={lines.join(' ')}>
            {lines.map((line, i) => {
                const start = offset;
                offset += line.length;
                const shown = Math.max(0, Math.min(line.length, typed - start));
                const letters = Array.from(line);
                return (
                    <span key={i} className={`block ${lineClassNames[i] ?? ''}`} aria-hidden>
                        {letters.slice(0, shown).map((char, j) => (
                            <span key={j} className="typed-letter">
                                {char}
                            </span>
                        ))}
                        {caretLine === i && (
                            <span className="typed-caret-slot">
                                <span className="typed-caret" />
                            </span>
                        )}
                        <span className="invisible">{letters.slice(shown).join('')}</span>
                    </span>
                );
            })}
        </h1>
    );
}
