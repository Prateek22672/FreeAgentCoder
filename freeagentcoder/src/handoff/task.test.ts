import { describe, expect, it } from 'vitest';
import type { ProjectTask } from './decode';
import { readHandoff } from './task';

/**
 * A link exactly as the website writes one. Kept as a literal rather than
 * built with the website's own encoder: the extension no longer depends on it,
 * so this string is the canary that catches the two sides drifting apart.
 */
const GOLDEN = 'eyJ2IjoxLCJraW5kIjoicHJvamVjdC10YXNrIiwicmVwbyI6InNoYWRjbi11aS90YXhvbm9teSIsInJlZiI6Im1haW4iLCJ0aXRsZSI6IlJlcGxhY2UgUHJpc21hIHdpdGggRHJpenpsZSIsImJyaWVmIjoiIyBSZXBsYWNlIFByaXNtYSB3aXRoIERyaXp6bGVcblxuUGxhbm5lZCBmb3IgYHNoYWRjbi11aS90YXhvbm9teWAgKGJyYW5jaCBtYWluKS5cblxuIyMgUGxhblxuMS4gKipVcGRhdGUgdGhlIGRhdGEgbW9kZWxzKiog4oCUIGNoYW5nZSB0aGUgc2hhcGVzIGZpcnN0LlxuICAgRmlsZXM6IGBsaWIvZGIudHNgXG5cbiMjIFJ1bGVzXG4tIFJlYWQgZXZlcnkgZmlsZSBiZWZvcmUgY2hhbmdpbmcgaXQuIiwiZmlsZXMiOlsibGliL2RiLnRzIiwiYXBwL2FwaS91c2Vycy9yb3V0ZS50cyJdfQ';

const encode = (task: ProjectTask): string => Buffer.from(JSON.stringify(task)).toString('base64url');
const decoded = JSON.parse(Buffer.from(GOLDEN, 'base64url').toString('utf8')) as ProjectTask;
const query = `p=${GOLDEN}`;

describe('a task handed over from the planner', () => {
    it('reads a real link and puts its brief up for review', () => {
        const result = readHandoff('/task', query, 'taxonomy');
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.task.brief).toContain('# Replace Prisma with Drizzle');
        expect(result.task.files).toContain('lib/db.ts');
        expect(result.note).toMatch(/Review it, then press Send/);
    });

    it('warns when the open folder is a different project, or none is open', () => {
        const other = readHandoff('/task', query, 'my-portfolio');
        expect(other.ok && other.note).toMatch(/the open folder is "my-portfolio"/);
        const none = readHandoff('/task', query, undefined);
        expect(none.ok && none.note).toMatch(/Open that project's folder/);
    });

    it('refuses unknown paths, empty links and tampered payloads', () => {
        expect(readHandoff('/run', query, 'taxonomy')).toMatchObject({ ok: false });
        expect(readHandoff('/task', '', 'taxonomy')).toMatchObject({ ok: false, error: 'The task link is empty.' });
        expect(readHandoff('/task', 'p=!!!', 'taxonomy')).toMatchObject({ ok: false });
        const escaping = encode({ ...decoded, files: ['../../.ssh/id_rsa'] });
        expect(readHandoff('/task', `p=${escaping}`, 'taxonomy')).toMatchObject({ ok: false, error: 'The task lists invalid file paths.' });
        const absolute = encode({ ...decoded, files: ['C:/Windows/System32/drivers/etc/hosts'] });
        expect(readHandoff('/task', `p=${absolute}`, 'taxonomy')).toMatchObject({ ok: false, error: 'The task lists invalid file paths.' });
        const newer = encode({ ...decoded, v: 2 as unknown as 1 });
        expect(readHandoff('/task', `p=${newer}`, 'taxonomy')).toMatchObject({ ok: false });
        const elsewhere = encode({ ...decoded, repo: 'https://evil.example/repo' });
        expect(readHandoff('/task', `p=${elsewhere}`, 'taxonomy')).toMatchObject({ ok: false, error: 'The task names an invalid repository.' });
    });
});
