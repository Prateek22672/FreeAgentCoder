import { analyzeImpact, buildPlan, buildRepoInput, createTask, encodeTask } from '@agentic/project-brain';
import { describe, expect, it } from 'vitest';
import { readHandoff } from './task';

const encoder = new TextEncoder();
const input = buildRepoInput([
    { path: 'lib/db.ts', bytes: encoder.encode("import { PrismaClient } from '@prisma/client';") },
    { path: 'app/api/users/route.ts', bytes: encoder.encode("import { db } from '../../../lib/db';") },
]);
const impact = analyzeImpact({ query: 'Replace Prisma', input });
const task = createTask({ repo: 'shadcn-ui/taxonomy', ref: 'main', title: 'Replace Prisma', impact, plan: buildPlan(impact) });
const query = `p=${encodeTask(task)}`;

describe('Project Brain handoff', () => {
    it('reads a task from a link and puts its brief up for review', () => {
        const result = readHandoff('/task', query, 'taxonomy');
        expect(result.ok).toBe(true);
        if (!result.ok) {return;}
        expect(result.task.brief).toContain('# Replace Prisma');
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
        const evil = encodeTask({ ...task, files: ['../../.ssh/id_rsa'] });
        expect(readHandoff('/task', `p=${evil}`, 'taxonomy')).toMatchObject({ ok: false, error: 'The task lists invalid file paths.' });
    });
});
