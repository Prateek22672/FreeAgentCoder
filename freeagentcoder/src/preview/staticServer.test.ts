import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveInside, startStaticServer, type StaticServer } from './staticServer';

let base: string;
let server: StaticServer;

beforeAll(async () => {
    base = await mkdtemp(path.join(tmpdir(), 'fac-preview-'));
    await mkdir(path.join(base, 'game', 'js'), { recursive: true });
    await writeFile(path.join(base, 'game', 'index.html'), '<!doctype html><script type="module" src="js/game.js"></script>');
    await writeFile(path.join(base, 'game', 'js', 'game.js'), 'export const ready = true;');
    await writeFile(path.join(base, 'secret.txt'), 'not part of the page');
    await writeFile(path.join(base, 'game', '.env'), 'KEY=not part of the page');
    server = await startStaticServer(path.join(base, 'game'));
});

afterAll(async () => {
    server.close();
    await rm(base, { recursive: true, force: true });
});

describe('preview server', () => {
    it('serves the page and its scripts with the right types', async () => {
        const page = await fetch(`${server.origin}/`);
        expect(page.status).toBe(200);
        expect(page.headers.get('content-type')).toContain('text/html');
        expect(await page.text()).toContain('js/game.js');
        const script = await fetch(`${server.origin}/js/game.js`);
        // A module script is refused by the browser unless it is served as JavaScript.
        expect(script.headers.get('content-type')).toContain('text/javascript');
        expect(script.headers.get('cache-control')).toBe('no-store');
    });

    it('listens on this computer only', () => {
        expect(server.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    });

    it('never serves anything outside the folder', async () => {
        expect(resolveInside(server.root, '/../secret.txt')).toBe(path.join(server.root, 'secret.txt'));
        expect(resolveInside(server.root, '/..%2f..%2fsecret.txt')).toBe(path.join(server.root, 'secret.txt'));
        expect(resolveInside(server.root, '/%00')).toBeUndefined();
        expect(resolveInside(server.root, '/%E0%A4%A')).toBeUndefined();
        for (const attempt of ['/../secret.txt', '/..%2fsecret.txt', '/js/..%2f..%2fsecret.txt', '/%2e%2e/secret.txt', '/..\\secret.txt']) {
            const response = await fetch(`${server.origin}${attempt}`);
            expect(await response.text()).not.toContain('not part of the page');
        }
    });

    it('never serves hidden files, or a request made under another name', async () => {
        expect(resolveInside(server.root, '/.env')).toBeUndefined();
        expect(resolveInside(server.root, '/.git/config')).toBeUndefined();
        expect((await fetch(`${server.origin}/.env`)).status).toBe(403);
        // What a page on another site would send after pointing its own domain here.
        const port = Number(new URL(server.origin).port);
        const status = await new Promise<number>((resolve, reject) => {
            get({ host: '127.0.0.1', port, path: '/index.html', headers: { host: 'attacker.example' } }, (response) => {
                response.resume();
                resolve(response.statusCode ?? 0);
            }).on('error', reject);
        });
        expect(status).toBe(403);
    });

    it('answers 404 for a missing file and refuses writes', async () => {
        expect((await fetch(`${server.origin}/missing.css`)).status).toBe(404);
        expect((await fetch(`${server.origin}/index.html`, { method: 'POST', body: 'x' })).status).toBe(405);
    });
});
