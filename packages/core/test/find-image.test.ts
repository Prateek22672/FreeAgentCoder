import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { creditLine, findImageTool, relevance, usable, useImageSearch, type ImageCandidate } from '../src/node/find-image';
import { isPrepared } from '../src/tools/types';
import { LocalWorkspace } from '../src/node/local-workspace';

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

  it('accepts the stock licences, which allow any use without payment', () => {
    for (const license of ['Pexels License', 'Pixabay Content License', 'Unsplash License']) expect(usable(image({ license }), 1000)).toBe(true);
  });
});

describe('find_image with a stock-photo search', () => {
  afterEach(() => {
    useImageSearch(undefined);
    vi.unstubAllGlobals();
  });

  it('takes the stock photo first and never asks the archives when it has one', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'fac-img-'));
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(String(url));
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { headers: { 'content-type': 'image/jpeg' } });
    });
    useImageSearch(async () => [
      image({ title: 'Doctor reading an x-ray on a tablet', url: 'https://images.pexels.com/photos/1.jpeg?w=1920', license: 'Pexels License', author: 'Jo Lens', source: 'https://www.pexels.com/photo/1/' }),
      image({ title: 'Small', url: 'https://images.pexels.com/photos/2.jpeg', width: 400, license: 'Pexels License' }),
    ]);
    const ctx = { workspace: new LocalWorkspace(root), signal: new AbortController().signal };
    const prepared = await findImageTool.prepare({ query: 'doctor x-ray tablet', save_as: '.freeagentcoder/images/xray.jpg' }, ctx as never);
    expect(isPrepared(prepared)).toBe(true);
    const result = await (prepared as { run: () => Promise<{ content: string }> }).run();
    expect(result.content).toContain('Pexels License');
    expect(result.content).toContain('Jo Lens');
    expect(asked).toEqual(['https://images.pexels.com/photos/1.jpeg?w=1920']);
    expect(readFileSync(path.join(root, '.freeagentcoder/images/xray.jpg')).length).toBe(4);
  });
});
