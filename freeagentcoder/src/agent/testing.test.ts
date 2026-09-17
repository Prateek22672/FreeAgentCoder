import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluateGates } from './playbooks';
import { detectChecks, type ProjectCheck } from './projectChecks';
import { codeChanged, testBrief, testPlaybook, verificationReview, type SequencedRun } from './testing';

let root: string;
let checks: ProjectCheck[];

beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'fac-testing-'));
    await writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ scripts: { typecheck: 'tsc --noEmit', test: 'vitest run', build: 'vite build' }, devDependencies: { typescript: '^5' } }),
    );
    checks = await detectChecks(root, 'linux');
});

afterAll(async () => {
    await rm(root, { recursive: true, force: true });
});

const run = (command: string, exitCode: number, seq: number): SequencedRun => ({ command, exitCode, background: false, seq });

describe('testPlaybook', () => {
    it("makes every detected check a required gate that recognizes the agent's commands", () => {
        const playbook = testPlaybook(checks);
        expect(playbook.gates.map((g) => g.command)).toEqual(checks.map((c) => c.command));
        expect(playbook.gates.every((g) => g.required === 'always')).toBe(true);

        const gates = evaluateGates([playbook], [run('npm run typecheck', 0, 1), run('npm test', 1, 2)], false);
        expect(gates.find((g) => g.command === 'npm run typecheck')?.status).toBe('passed');
        expect(gates.find((g) => g.command === 'npm test')?.status).toBe('failed');
        expect(gates.find((g) => g.command === 'npm run build')?.status).toBe('not_run');
    });
});

describe('testBrief', () => {
    it('lists the checks, forbids edits and asks for a structured report', () => {
        const brief = testBrief(checks, 'app\n  src/');
        expect(brief).toContain('`npm test`');
        expect(brief).toContain('do not change any files');
        expect(brief).toContain('## Test report');
        expect(brief).toContain('**How to fix:**');
        expect(brief).toContain('Never start a full training run');
        expect(brief).toContain('## Project structure');
    });

    it('asks the agent to find the checks when none were detected', () => {
        expect(testBrief([], '')).toContain('None were detected automatically');
    });
});

describe('codeChanged', () => {
    it('ignores documentation-only changes', () => {
        expect(codeChanged(['README.md', 'docs/guide.mdx'])).toBe(false);
        expect(codeChanged(['README.md', 'src/app.ts'])).toBe(true);
    });
});

describe('verificationReview', () => {
    it('asks for a check when code changed after the last one', () => {
        const message = verificationReview(checks, [run('npm run typecheck', 0, 1)], 2, 'Done! Added the toggle.');
        expect(message).toMatch(/haven't checked it since your last edit/);
        expect(message).toContain('npm run typecheck');
    });

    it('reports a check that failed after the last edit', () => {
        expect(verificationReview(checks, [run('npm test', 1, 3)], 2, 'All done.')).toMatch(/`npm test` failed after your last change/);
    });

    it('lets the task finish once a check passes after the last edit', () => {
        expect(verificationReview(checks, [run('npm test', 1, 3), run('pnpm exec tsc --noEmit', 0, 4)], 2, 'All done.')).toBeUndefined();
    });

    it('does not count unrelated commands or background processes', () => {
        const runs = [run('npm install', 0, 3), { ...run('npm run build', 0, 4), background: true }];
        expect(verificationReview(checks, runs, 2, 'All done.')).toBeDefined();
    });

    it('accepts a clear explanation of why no check can run', () => {
        expect(verificationReview(checks, [], 2, 'I could not run the tests because Node.js is not installed.')).toBeUndefined();
        expect(verificationReview(checks, [], 2, 'Should I install the dependencies first?')).toBeUndefined();
    });
});
