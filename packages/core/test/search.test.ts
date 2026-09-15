import { describe, expect, it } from 'vitest';
import { CodeIndex, tokenize } from '../src/tools/search';
import { MemoryWorkspace } from '../src/workspace/memory';

const files = {
  '/src/auth/login.ts': 'export async function loginUser(email: string, password: string) {\n  return verifyPassword(email, password);\n}\n',
  '/src/wallpaper/download.ts':
    'export async function downloadWallpaper(url: string) {\n  const response = await fetch(url);\n  return saveImage(await response.blob());\n}\n',
  '/src/ui/button.tsx': 'export function Button() {\n  return null;\n}\n',
  '/node_modules/lib/index.js': 'function downloadWallpaper() {}\n',
};

describe('tokenize', () => {
  it('splits identifiers into words and drops noise', () => {
    expect(tokenize('getUserProfile user_settings HTTPServer')).toEqual(['user', 'profile', 'user', 'setting', 'http', 'server']);
  });
});

describe('CodeIndex', () => {
  it('ranks the file that matches a description first and skips ignored folders', async () => {
    const index = new CodeIndex(new MemoryWorkspace(files));
    await index.refresh();

    const hits = index.search('download the wallpaper image');

    expect(hits[0]?.path).toBe('src/wallpaper/download.ts');
    expect(hits[0]?.matched).toEqual(expect.arrayContaining(['download', 'wallpaper', 'image']));
    expect(hits.some((hit) => hit.path.includes('node_modules'))).toBe(false);
    expect(await index.snippet(hits[0]!)).toContain('downloadWallpaper');
  });

  it('re-indexes changed files and forgets deleted ones', async () => {
    const ws = new MemoryWorkspace(files);
    const index = new CodeIndex(ws);
    await index.refresh();

    await ws.writeFile('/src/ui/button.tsx', 'export function PaymentButton() {\n  return checkoutPayment();\n}\n');
    await ws.deleteFile('/src/auth/login.ts');
    await index.refresh();

    expect(index.search('payment checkout')[0]?.path).toBe('src/ui/button.tsx');
    expect(index.search('login password')).toEqual([]);
  });

  it('returns nothing for a query made only of noise words', async () => {
    const index = new CodeIndex(new MemoryWorkspace(files));
    await index.refresh();
    expect(index.search('please add the code')).toEqual([]);
  });
});
