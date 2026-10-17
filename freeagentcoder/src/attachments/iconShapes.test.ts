import { describe, expect, it } from 'vitest';
import { ICON_NAMES } from './icons';
import { iconPoints } from './iconShapes';

describe('icons as native shapes', () => {
    it('draws every icon inside its box', () => {
        for (const name of ICON_NAMES) {
            const points = iconPoints(name, 1)!;
            expect(points.length, name).toBeGreaterThan(1);
            for (const p of points) {
                if ('x' in p) {
                    expect(p.x, name).toBeGreaterThanOrEqual(-0.05);
                    expect(p.x, name).toBeLessThanOrEqual(1.05);
                    expect(p.y, name).toBeGreaterThanOrEqual(-0.05);
                    expect(p.y, name).toBeLessThanOrEqual(1.05);
                }
            }
        }
    });

    it('starts a path written with a relative "m" from the corner, not from the previous shape', () => {
        // trending-up: <path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>
        const points = iconPoints('trending-up', 24)!;
        const second = points.filter((p) => 'moveTo' in p && p.moveTo)[1] as { x: number; y: number };
        expect(second).toEqual({ x: 22, y: 7, moveTo: true });
    });

    it('knows nothing it was not given', () => {
        expect(iconPoints('no-such-icon', 1)).toBeUndefined();
    });
});
