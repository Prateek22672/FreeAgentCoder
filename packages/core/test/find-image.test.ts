import { describe, expect, it } from 'vitest';
import { creditLine, relevance, usable, type ImageCandidate } from '../src/node/find-image';

const image = (over: Partial<ImageCandidate> = {}): ImageCandidate => ({ title: 'Kathmandu flood rescue boats', url: 'https://x/y.jpg', width: 1600, height: 900, license: 'CC BY-SA 4.0', author: 'A. Photographer', source: 'https://commons.wikimedia.org/wiki/File:x.jpg', ...over });

describe('find_image', () => {
  it('keeps only licences free for any use, and images big enough', () => {
    expect(usable(image(), 1000)).toBe(true);
    expect(usable(image({ license: 'CC0' }), 1000)).toBe(true);
    expect(usable(image({ license: 'CC BY-NC 2.0' }), 1000)).toBe(false);
    expect(usable(image({ license: 'CC BY-ND 4.0' }), 1000)).toBe(false);
    expect(usable(image({ license: 'All rights reserved' }), 1000)).toBe(false);
    expect(usable(image({ width: 640 }), 1000)).toBe(false);
  });

  it('ranks by the words a title shares with the query, and writes the credit', () => {
    expect(relevance('Kathmandu flood rescue boats', 'kathmandu flood 2024 rescue')).toBe(3);
    expect(creditLine(image())).toBe('Kathmandu flood rescue boats — A. Photographer, CC BY-SA 4.0, via https://commons.wikimedia.org/wiki/File:x.jpg');
  });
});
