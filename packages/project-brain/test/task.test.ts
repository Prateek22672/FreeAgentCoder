import { describe, expect, it } from 'vitest';
import {
    EXTENSION_ID,
    TASK_LIMITS,
    analyzeImpact,
    buildPlan,
    buildRepoInput,
    collectDependencies,
    createTask,
    decodeTask,
    encodeTask,
    taskUrl,
    type ProjectTask,
    type RawEntry,
} from '../src/index';

const encoder = new TextEncoder();
const raw = (files: Record<string, string>): RawEntry[] => Object.entries(files).map(([path, text]) => ({ path, bytes: encoder.encode(text) }));

const input = buildRepoInput(
    raw({
        'package.json': JSON.stringify({ dependencies: { '@prisma/client': '5', next: '15' } }),
        'prisma/schema.prisma': 'model User { id String }',
        'lib/db.ts': "import { PrismaClient } from '@prisma/client';\nexport const db = new PrismaClient();",
        'app/api/users/route.ts': "import { db } from '../../../lib/db';\nexport const GET = () => db.user.findMany();",
        'components/users.tsx': "import { db } from '../lib/db';\nexport function Users() { return null; }",
        'lib/db.test.ts': "import { db } from './db';",
        'README.md': 'Uses Prisma.',
    }),
);
const impact = analyzeImpact({ query: 'Replace Prisma with Drizzle', input, dependencies: collectDependencies(input) });

const sample = (): ProjectTask => createTask({ repo: 'shadcn-ui/taxonomy', ref: 'main', title: 'Replace Prisma with Drizzle', impact, plan: buildPlan(impact), stack: 'Next.js · Prisma' });

describe('plan', () => {
    it('orders the work the way a careful engineer would: scope, data, logic, API, UI, tests, verify', () => {
        const titles = buildPlan(impact).map((s) => s.title);
        expect(titles[0]).toBe('Confirm the scope');
        expect(titles.at(-1)).toBe('Verify');
        const at = (t: string) => titles.findIndex((x) => x.startsWith(t));
        expect(at('Update services')).toBeLessThan(at('Update the API'));
        expect(at('Update the API')).toBeLessThan(at('Update the UI'));
        expect(at('Update the UI')).toBeLessThan(at('Update and extend the tests'));
        expect(titles).toContain('Handle the dependencies involved');
    });

    it('builds a brief the agent can work from, with the real files', () => {
        const task = sample();
        expect(task.brief).toContain('# Replace Prisma with Drizzle');
        expect(task.brief).toContain('`lib/db.ts`');
        expect(task.brief).toContain('static analysis');
        expect(task.brief).toMatch(/Finish only when the project's own checks pass/);
        expect(task.files).toContain('lib/db.ts');
    });
});

describe('link encoding', () => {
    it('round-trips a task through a vscode:// link, including non-ASCII text', () => {
        const task = { ...sample(), title: 'Rename café → cafe, 日本語 ✓' };
        const url = taskUrl(task);
        expect(url.startsWith(`vscode://${EXTENSION_ID}/task?p=`)).toBe(true);
        expect(url).toMatch(/^[\x21-\x7e]+$/); // nothing that needs escaping
        const decoded = decodeTask(url.split('p=')[1]!);
        expect(decoded).toEqual(task);
    });

    it('stays small enough for a link', () => {
        expect(encodeTask(sample()).length).toBeLessThan(12_000);
    });
});

describe('untrusted links are refused', () => {
    const encode = (value: unknown) => encodeTask(value as ProjectTask);

    it('rejects garbage and the wrong version or kind', () => {
        expect(decodeTask('not base64!')).toHaveProperty('error');
        expect(decodeTask(encode({ hello: 'world' }))).toHaveProperty('error');
        expect(decodeTask(encode({ ...sample(), v: 2 }))).toMatchObject({ error: expect.stringContaining('newer') });
        expect(decodeTask(encode({ ...sample(), kind: 'shell' }))).toHaveProperty('error');
    });

    it('rejects paths that escape the project', () => {
        for (const bad of ['../../etc/passwd', '/etc/passwd', 'C:/Windows/system32', 'src/../../x', 'file:///etc/passwd', '\\\\server\\share']) {
            expect(decodeTask(encode({ ...sample(), files: [bad] })), bad).toHaveProperty('error');
        }
        expect(decodeTask(encode({ ...sample(), files: ['app/(dashboard)/[id]/page.tsx'] }))).not.toHaveProperty('error');
    });

    it('rejects oversize fields and invalid repositories', () => {
        expect(decodeTask(encode({ ...sample(), brief: 'x'.repeat(TASK_LIMITS.brief + 1) }))).toHaveProperty('error');
        expect(decodeTask(encode({ ...sample(), files: Array.from({ length: 41 }, (_, i) => `f${i}.ts`) }))).toHaveProperty('error');
        expect(decodeTask(encode({ ...sample(), repo: 'evil.com/../x' }))).toHaveProperty('error');
        expect(decodeTask('A'.repeat(40_001))).toHaveProperty('error');
    });

    it('strips control and bidirectional-override characters that could disguise text', () => {
        const decoded = decodeTask(encode({ ...sample(), title: 'Fix\u0007 login\u202E', brief: 'Line one\u0000\nLine two' }));
        expect(decoded).toMatchObject({ title: 'Fix login', brief: 'Line one\nLine two' });
    });
});

/**
 * The extension decodes links with its own copy of the reader, so that it
 * depends on nothing outside itself. This is the same payload its tests use:
 * if the wire format changes on either side, one of the two fails.
 */
describe('the wire format the extension reads', () => {
    it('has not drifted', () => {
        const task: ProjectTask = {
            v: 1,
            kind: 'project-task',
            repo: 'shadcn-ui/taxonomy',
            ref: 'main',
            title: 'Replace Prisma with Drizzle',
            brief: '# Replace Prisma with Drizzle\n\nPlanned for `shadcn-ui/taxonomy` (branch main).\n\n## Plan\n1. **Update the data models** — change the shapes first.\n   Files: `lib/db.ts`\n\n## Rules\n- Read every file before changing it.',
            files: ['lib/db.ts', 'app/api/users/route.ts'],
        };
        expect(encodeTask(task)).toBe('eyJ2IjoxLCJraW5kIjoicHJvamVjdC10YXNrIiwicmVwbyI6InNoYWRjbi11aS90YXhvbm9teSIsInJlZiI6Im1haW4iLCJ0aXRsZSI6IlJlcGxhY2UgUHJpc21hIHdpdGggRHJpenpsZSIsImJyaWVmIjoiIyBSZXBsYWNlIFByaXNtYSB3aXRoIERyaXp6bGVcblxuUGxhbm5lZCBmb3IgYHNoYWRjbi11aS90YXhvbm9teWAgKGJyYW5jaCBtYWluKS5cblxuIyMgUGxhblxuMS4gKipVcGRhdGUgdGhlIGRhdGEgbW9kZWxzKiog4oCUIGNoYW5nZSB0aGUgc2hhcGVzIGZpcnN0LlxuICAgRmlsZXM6IGBsaWIvZGIudHNgXG5cbiMjIFJ1bGVzXG4tIFJlYWQgZXZlcnkgZmlsZSBiZWZvcmUgY2hhbmdpbmcgaXQuIiwiZmlsZXMiOlsibGliL2RiLnRzIiwiYXBwL2FwaS91c2Vycy9yb3V0ZS50cyJdfQ');
    });
});
