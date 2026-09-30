'use client';

import { useRef } from 'react';
import { clamp, ease, span, useScrollProgress } from './progress';

interface Tile {
    label: string;
    x: number; // % of the width from the centre
    y: number; // % of the height from the centre
    z: number; // starting depth, px
    w: number; // px at depth 0
    ratio: number;
    look: string;
}

const TILES: Tile[] = [
    { label: 'Playground', x: 12, y: -26, z: -250, w: 360, ratio: 1.35, look: 'cine-tile-holo' },
    { label: 'Impact', x: -12, y: 30, z: -120, w: 330, ratio: 1.45, look: 'cine-look-chrome' },
    { label: 'Search', x: -44, y: -36, z: -700, w: 170, ratio: 0.75, look: 'cine-tile-violet' },
    { label: 'Architecture', x: -30, y: -2, z: -420, w: 190, ratio: 0.72, look: 'cine-tile-red' },
    { label: 'Plans', x: 36, y: 0, z: -380, w: 230, ratio: 1.2, look: 'cine-tile-signal' },
    { label: 'Specialists', x: 46, y: -36, z: -560, w: 160, ratio: 0.6, look: 'cine-tile-violet' },
    { label: 'Diffs', x: 40, y: 30, z: -320, w: 190, ratio: 1.3, look: 'cine-tile-dusk' },
    { label: 'Tests', x: 20, y: 44, z: -600, w: 150, ratio: 1.2, look: 'cine-tile-orb' },
    { label: 'Private', x: -44, y: 42, z: -300, w: 170, ratio: 1.1, look: 'cine-tile-ember' },
    { label: 'Undo', x: -14, y: -22, z: -950, w: 140, ratio: 1, look: 'cine-tile-teal' },
    { label: 'Image text', x: 22, y: 14, z: -1250, w: 200, ratio: 1.3, look: 'cine-tile-dusk' },
    { label: 'Free keys', x: -24, y: -10, z: -1450, w: 220, ratio: 0.8, look: 'cine-tile-ember' },
    { label: 'Starters', x: 30, y: -24, z: -1650, w: 240, ratio: 1.2, look: 'cine-tile-holo' },
    { label: 'Hand-off', x: -6, y: 28, z: -1850, w: 260, ratio: 1.4, look: 'cine-tile-violet' },
];

/**
 * A field of tiles, each one a part of the product, that you fly through as
 * you scroll. The words in the middle hold still while the tiles pass.
 */
export function Library() {
    const host = useRef<HTMLElement>(null);
    const field = useRef<HTMLDivElement>(null);
    const words = useRef<HTMLDivElement>(null);

    useScrollProgress(
        host,
        (p) => {
            const tiles = field.current ? (Array.from(field.current.children) as HTMLElement[]) : [];
            const forward = p * 1300;
            tiles.forEach((el, i) => {
                const tile = TILES[i];
                const z = tile.z + forward;
                el.style.transform = `translate(-50%, -50%) translate3d(${tile.x}vw, ${tile.y}vh, ${z}px)`;
                el.style.opacity = String(clamp((z + 2000) / 900) * clamp((520 - z) / 320));
                el.style.visibility = z > 520 ? 'hidden' : 'visible';
            });
            if (words.current) {
                const t = ease(span(p, 0.12, 0.4)) * (1 - span(p, 0.85, 1));
                words.current.style.opacity = String(t);
                words.current.style.transform = `translate(-50%, -50%) scale(${0.92 + t * 0.08})`;
            }
        },
        0.35,
    );

    return (
        <section ref={host} className="relative h-[280vh] bg-[#070708] text-white" aria-labelledby="library-title">
            <div className="sticky top-0 h-dvh overflow-hidden [perspective:1000px]">
                <div ref={field} aria-hidden className="absolute inset-0 [transform-style:preserve-3d]">
                    {TILES.map((tile) => (
                        <div
                            key={tile.label}
                            className={`${tile.look} absolute left-1/2 top-1/2 overflow-hidden rounded-[10px] will-change-transform`}
                            style={{ width: `min(${tile.w}px, ${tile.w / 9}vw)`, aspectRatio: String(tile.ratio) }}
                        >
                            <span className="absolute left-2.5 top-2 text-[11px] text-white/55">{tile.label}</span>
                        </div>
                    ))}
                </div>
                <div ref={words} className="absolute left-1/2 top-1/2 z-10 w-[min(92vw,34rem)] text-center">
                    <h2 id="library-title" className="cine-display text-[clamp(2.2rem,5vw,3.6rem)] font-medium leading-[1.02] tracking-[-0.035em] [text-shadow:0_4px_30px_rgb(0_0_0/0.8)]">
                        A toolkit that
                        <br />
                        keeps growing
                    </h2>
                    <p className="mx-auto mt-4 max-w-[26rem] text-[14.5px] leading-relaxed text-white/60 [text-shadow:0_2px_16px_rgb(0_0_0/0.9)]">
                        Specialists, starters and guides, with more in every release. Every part is free and open source.
                    </p>
                </div>
            </div>
        </section>
    );
}
