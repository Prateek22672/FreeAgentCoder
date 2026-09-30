'use client';

import { useEffect } from 'react';

/**
 * Sections rise into place as they scroll into view.
 *
 * Nothing is hidden until this has run in the browser: the stylesheet only
 * applies the hidden state under `body[data-reveal]`, which this sets on
 * mount, so a crawler, a reader with scripts off, or the first paint before
 * hydration all see the finished page. Anyone with reduced motion set sees
 * everything in place with no animation.
 */
export function Reveal() {
    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
        if (!targets.length) return;
        document.body.dataset.reveal = 'on';
        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('is-visible');
                        observer.unobserve(entry.target);
                    }
                }
            },
            { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
        );
        for (const target of targets) observer.observe(target);
        // If the observer never fires for any reason, nothing may stay hidden.
        const safety = window.setTimeout(() => {
            for (const target of targets) target.classList.add('is-visible');
        }, 3000);
        return () => {
            window.clearTimeout(safety);
            observer.disconnect();
            delete document.body.dataset.reveal;
        };
    }, []);
    return null;
}
