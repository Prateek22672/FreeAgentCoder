'use client';

import { useEffect, useState } from 'react';
import { Logo } from '@/components/Logo';
import { GITHUB } from '@/lib/site';

const LINKS = [
    { href: '/playground', label: 'Playground' },
    { href: '#brain', label: 'Read a repo' },
    { href: '#work', label: 'What it does' },
    { href: '#guides', label: 'Guides' },
    { href: GITHUB, label: 'GitHub', external: true },
];

/**
 * The floating pill at the top. It reads the section underneath it — any
 * element marked data-nav="light" — and turns white over light ones and dark
 * over dark ones, so it is always legible.
 */
export function PillNav() {
    const [light, setLight] = useState(false);

    useEffect(() => {
        let frame = 0;
        const check = () => {
            frame = 0;
            const y = 36;
            let over = false;
            document.querySelectorAll<HTMLElement>('[data-nav="light"]').forEach((el) => {
                const r = el.getBoundingClientRect();
                if (r.top <= y && r.bottom >= y) over = true;
            });
            setLight(over);
        };
        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(check);
        };
        check();
        window.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule);
        return () => {
            window.removeEventListener('scroll', schedule);
            window.removeEventListener('resize', schedule);
            cancelAnimationFrame(frame);
        };
    }, []);

    return (
        <header className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-3 sm:top-4">
            <nav
                aria-label="Main"
                className={`pointer-events-auto flex items-center gap-0.5 rounded-full p-1 pl-2 text-[13.5px] shadow-[0_10px_40px_-12px_rgb(0_0_0/0.45)] backdrop-blur-xl transition-colors duration-500 ${
                    light ? 'bg-white/90 text-zinc-800' : 'bg-[#0c0c0e]/70 text-white/85'
                }`}
            >
                <a href="/" aria-label="FreeAgentCoder home" className="flex size-8 items-center justify-center rounded-full">
                    <Logo size={16} className={light ? 'text-zinc-900' : 'text-white'} />
                </a>
                {LINKS.map((link) => (
                    <a
                        key={link.label}
                        href={link.href}
                        {...(link.external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
                        className={`hidden rounded-full px-3 py-1.5 transition-colors sm:block ${light ? 'hover:bg-black/5' : 'hover:bg-white/10'}`}
                    >
                        {link.label}
                    </a>
                ))}
                <a href="/playground" className="px-2.5 py-1.5 sm:hidden">
                    Playground
                </a>
                <a
                    href="/playground"
                    className={`ml-1 rounded-full px-4 py-2 font-medium transition-colors duration-500 ${light ? 'bg-zinc-950 text-white' : 'bg-white text-zinc-950'}`}
                >
                    Get started
                </a>
            </nav>
        </header>
    );
}
