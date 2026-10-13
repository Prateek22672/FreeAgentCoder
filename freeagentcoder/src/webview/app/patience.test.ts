import { describe, expect, it } from 'vitest';
import { estimateLeft, patienceNote } from './patience';

describe('patienceNote', () => {
    it('stays quiet for the first 90 seconds', () => {
        expect(patienceNote(60_000, { done: 1, total: 4 })).toBeUndefined();
    });

    it('estimates the time left from the plan once a step is done', () => {
        expect(estimateLeft(120_000, { done: 2, total: 4 })).toBe(120_000);
        expect(estimateLeft(120_000, { done: 0, total: 4 })).toBeUndefined();
        expect(patienceNote(120_000, { done: 2, total: 4 })).toMatch(/2 of 4 steps done.*about 2 minutes/);
    });

    it('apologises warmly on a very long task without a plan', () => {
        expect(patienceNote(13 * 60_000, { done: 0, total: 0 })).toMatch(/Sorry|Thanks for hanging in/);
    });

    it('changes once a minute, not every second', () => {
        const a = patienceNote(150_000, { done: 0, total: 0 });
        expect(patienceNote(155_000, { done: 0, total: 0 })).toBe(a);
        expect(patienceNote(185_000, { done: 0, total: 0 })).not.toBe(a);
    });
});
