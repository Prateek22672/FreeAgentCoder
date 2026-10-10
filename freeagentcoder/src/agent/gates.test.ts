import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyTask, isFollowUp } from './catalog';
import { completionReview, filesNear, gateResults } from './gates';
import { buildBrief, choosePlaybooks, evaluateGates } from './playbooks';

let root: string;

beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'fac-gates-'));
    // A plain web game, and beside it an app with a real build.
    await mkdir(path.join(root, 'snake-and-ladder', 'js'), { recursive: true });
    await writeFile(path.join(root, 'snake-and-ladder', 'index.html'), '<!doctype html>');
    await writeFile(path.join(root, 'snake-and-ladder', 'js', 'game.js'), 'let turn = 0;');
    await mkdir(path.join(root, 'shop', 'src'), { recursive: true });
    await writeFile(path.join(root, 'shop', 'package.json'), '{"scripts":{"build":"vite build"}}');
    await writeFile(path.join(root, 'shop', 'src', 'App.tsx'), 'export default function App() { return null; }');
});

afterAll(async () => {
    await rm(root, { recursive: true, force: true });
});

const game = ['snake-and-ladder/index.html', 'snake-and-ladder/js/game.js'];
const reply = 'The game is ready.';

describe('gates for the project as it is', () => {
    const general = choosePlaybooks('make a snake and ladder game', 'deep', new Set());
    const web = choosePlaybooks('build a website for my shop', 'deep', new Set());

    it('reads the folders of the changed files, up to the root and no further', async () => {
        const names = await filesNear(root, ['shop/src/App.tsx']);
        expect(names.has('package.json')).toBe(true);
        expect(names.has('App.tsx')).toBe(true);
        expect(names.has('index.html')).toBe(false);
        expect([...(await filesNear(root, ['../outside/file.js']))].sort()).toEqual(['shop', 'snake-and-ladder']);
    });

    it('lets a plain HTML game finish with no build or tests run', async () => {
        expect(general.map((p) => p.id)).toEqual(['general']);
        // The old rule: refused until a build or test command that does not exist had passed.
        expect(evaluateGates(general, [], false).some((g) => g.required)).toBe(true);
        expect(await completionReview(general, [], false, root, game, reply)).toBeUndefined();
        expect((await gateResults(general, [], false, root, game)).every((g) => !g.required)).toBe(true);
    });

    it('lets a static site finish without npm run build', async () => {
        expect(web.map((p) => p.id)).toEqual(['web']);
        expect(await completionReview(web, [], false, root, game, reply)).toBeUndefined();
    });

    it('still holds a project with a build to it', async () => {
        const app = ['shop/src/App.tsx'];
        expect(await completionReview(web, [], false, root, app, reply)).toContain('Production build: not run');
        expect(await completionReview(general, [], false, root, app, reply)).toContain('Build or tests: not run');
        const failed = [{ command: 'npm run build', exitCode: 1, background: false }];
        expect(await completionReview(web, failed, false, root, app, reply)).toContain('failed (exit 1)');
        const passed = [{ command: 'npm run build', exitCode: 0, background: false }];
        expect(await completionReview(web, passed, false, root, app, reply)).toBeUndefined();
    });

    it('tells the agent to keep a small build small', () => {
        const brief = buildBrief(general, false, 'make a snake and ladder game');
        expect(brief).toContain('plain HTML, CSS and JavaScript');
        expect(brief).toContain('do not add a build system or a test runner just to pass one');
        expect(brief).not.toContain('Preflight: call inspect_environment');
        // A stack with real toolchains still checks they are installed.
        expect(buildBrief(choosePlaybooks('build a flutter app', 'deep', new Set()), false, 'x')).toContain('Preflight: call inspect_environment with');
    });
});

describe('Continue', () => {
    it('is a follow-up, so the task keeps its tier and checks', () => {
        expect(isFollowUp('Continue where you left off.')).toBe(true);
        expect(classifyTask('Continue where you left off.', 'deep').tier).toBe('deep');
    });
});

describe('the documents playbook', () => {
    it('is chosen for a request to make slides or a PDF', () => {
        const nepal = 'i need a small ppt for presenting this so min 10 slides, 12 slides total on Nepal floods 2026, keep images and flow charts and causes, a pdf';
        expect(choosePlaybooks(nepal, 'deep', new Set()).map((p) => p.id)).toEqual(['documents']);
        expect(choosePlaybooks('generate a pdf report of our sales data', 'deep', new Set()).map((p) => p.id)).toEqual(['documents']);
    });

    it('is not chosen for an app that happens to export PDFs', () => {
        expect(choosePlaybooks('build a web app that exports invoices as pdf', 'deep', new Set()).map((p) => p.id)).not.toContain('documents');
    });

    it('carries the colour and path rules that broke real builds', () => {
        const brief = buildBrief(choosePlaybooks('create a presentation on climate change', 'deep', new Set()), false, 'x');
        expect(brief).toContain('RGBColor.from_string');
        expect(brief).toContain('os.path.dirname(os.path.abspath(__file__))');
    });
});

describe('the .NET playbook', () => {
    it('is chosen for an ASP.NET build and requires dotnet build', () => {
        const chosen = choosePlaybooks('build a CRM web app in ASP.NET Core MVC with Identity', 'deep', new Set());
        expect(chosen.map((p) => p.id)).toEqual(['dotnet']);
        expect(chosen[0]!.toolchains).toEqual(['dotnet']);
    });
});
