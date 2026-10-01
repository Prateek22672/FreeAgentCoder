'use client';

import { useRef } from 'react';
import { Logo } from '@/components/Logo';
import { AgentDemo } from './AgentDemo';
import { Arrow, Star } from './Hero';
import { useScrollProgress } from './progress';

interface Card {
    chip: string;
    corner: string;
    title: string;
    body: string;
    look: string;
    dark?: boolean;
    href: string;
}

/** Each card is one thing the product does, and links to where you can try it. */
const CARDS: Card[] = [
    { chip: 'Project Brain', corner: 'freeagentcoder', title: '', body: '', look: 'cine-look-chrome', dark: true, href: '#brain' },
    { chip: 'Specialists', corner: 'debug · refactor', title: 'Reproduce first, then fix', body: 'The right method for each kind of task, not one prompt for all.', look: 'cine-look-teal', href: '/free-ai-coding-agent-vscode' },
    { chip: 'Starters', corner: 'playground', title: 'Start from a running app', body: 'React, plain HTML or a Node API, live in your browser in a minute.', look: 'cine-look-moss', href: '/playground' },
    { chip: 'Impact', corner: 'before code', title: 'See what a change breaks', body: 'Every file it reaches, and a risk level, before an edit is made.', look: 'cine-look-plum', href: '#brain' },
    { chip: 'Free keys', corner: 'no card', title: 'Know what each key gives', body: 'Gemini, Groq, Mistral and OpenRouter, with honest limits.', look: 'cine-look-ice', dark: true, href: '/free-ai-api-limits' },
    { chip: 'Live', corner: 'playground', title: 'Watch it build', body: 'Changes land in the files and appear in the running preview.', look: 'cine-look-magenta', href: '/playground' },
];

const WORDS = 'Understand before you change · Built in your editor · Free for everyone · ';

/**
 * A ring of cards turning in 3D while a line of huge type slides behind it.
 * Cards facing you come forward over the type; cards turning away pass behind.
 */
export function Carousel() {
    const host = useRef<HTMLElement>(null);
    const ring = useRef<HTMLDivElement>(null);
    const words = useRef<HTMLDivElement>(null);

    useScrollProgress(host, (p) => {
        const cards = ring.current ? (Array.from(ring.current.children) as HTMLElement[]) : [];
        const cardWidth = cards[0]?.offsetWidth ?? 300;
        const radius = Math.min(Math.max(window.innerWidth * 0.4, cardWidth * 1.35), 560);
        const step = (Math.PI * 2) / cards.length;
        const turn = p * Math.PI * 2 * 0.9;
        cards.forEach((card, i) => {
            // Wrap the angle into -π…π so every card has one place on the ring.
            let a = (i * step - turn) % (Math.PI * 2);
            if (a > Math.PI) a -= Math.PI * 2;
            if (a < -Math.PI) a += Math.PI * 2;
            const x = Math.sin(a) * radius;
            const z = (Math.cos(a) - 1) * radius;
            const facing = Math.cos(a);
            // Cards turn less than their place on the ring, so the sides stay readable.
            card.style.transform = `translate(-50%, -50%) perspective(1000px) translate3d(${x}px, 0, ${z}px) rotateY(${((a * 180) / Math.PI) * 0.6}deg)`;
            // Only the card facing you passes in front of the type.
            card.style.zIndex = String(facing > 0.8 ? 30 : 1 + Math.round((facing + 1) * 5));
            card.style.opacity = String(Math.max(0, Math.min(1, (facing + 0.3) * 2.2)));
            card.style.visibility = facing < -0.2 ? 'hidden' : 'visible';
        });
        if (words.current) {
            const travel = words.current.scrollWidth / 2;
            words.current.style.transform = `translate3d(${-p * travel}px, -50%, 0)`;
        }
    });

    return (
        <section ref={host} id="work" data-nav="light" className="cine-carousel relative h-[320vh] bg-[#070708]" aria-label="What it does">
            <div className="sticky top-0 h-dvh overflow-hidden rounded-b-[28px] bg-[#efeff2]">
                <div
                    ref={words}
                    aria-hidden
                    className="cine-display pointer-events-none absolute left-0 top-1/2 z-10 whitespace-nowrap text-[clamp(5rem,15vw,13rem)] font-medium leading-none tracking-[-0.05em] text-zinc-950 will-change-transform"
                >
                    {WORDS}
                    {WORDS}
                </div>
                <div ref={ring} className="absolute left-1/2 top-[47%]">
                    {/* The hero's panel lands here as the front card; on wide screens it flies in from the hero. */}
                    <div data-fly="to" className="cine-ring-card panel-card absolute left-0 top-0 w-[clamp(190px,27vw,330px)] overflow-hidden rounded-[18px] will-change-transform">
                        <AgentDemo width="w-full" frozen />
                    </div>
                    {CARDS.map((card) => (
                        <a
                            key={card.chip}
                            href={card.href}
                            className={`cine-ring-card ${card.look} absolute left-0 top-0 flex aspect-[0.74] w-[clamp(190px,27vw,330px)] flex-col overflow-hidden rounded-[22px] p-4 will-change-transform ${card.dark ? 'text-zinc-900' : 'text-white'}`}
                        >
                            <span className="flex items-start justify-between text-[11.5px]">
                                <span className={`rounded-full px-2.5 py-1 font-medium backdrop-blur ${card.dark ? 'bg-black/70 text-white' : 'bg-black/30'}`}>{card.chip}</span>
                                <span className="pt-1 opacity-60">{card.corner}</span>
                            </span>
                            {card.title ? (
                                <span className="mt-auto">
                                    <span className="block text-[clamp(1.2rem,2vw,1.6rem)] font-semibold leading-[1.1] tracking-tight">{card.title}</span>
                                    <span className="mt-2 block text-[12.5px] leading-relaxed opacity-75">{card.body}</span>
                                </span>
                            ) : (
                                <span className="mt-auto flex items-end justify-between">
                                    <Star size={56} className="text-white drop-shadow-[0_4px_20px_rgb(255_255_255/0.7)]" />
                                    <Logo size={22} className="text-zinc-800/70" />
                                </span>
                            )}
                        </a>
                    ))}
                </div>
                <div className="absolute inset-x-0 bottom-[6%] z-40 flex justify-center">
                    <a href="/playground" className="group inline-flex items-center gap-2 rounded-[12px] bg-zinc-950 px-6 py-3.5 text-[14.5px] font-medium text-white shadow-[0_14px_40px_-12px_rgb(0_0_0/0.6)] transition-transform hover:scale-[1.03]">
                        Open the Playground <span className="transition-transform group-hover:translate-x-0.5"><Arrow size={14} /></span>
                    </a>
                </div>
            </div>
        </section>
    );
}
