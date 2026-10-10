import { unlinkSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ModelRouter } from '@agentic/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, calls, say, ScriptedProvider, type Step } from '../../../packages/core/test/helpers';
import { findBrowser } from '../preview/checkPage';
import { PagePreviews } from '../preview/pages';
import type { ToWebview } from '../shared/protocol';
import { choosePlaybooks } from './playbooks';
import { AgentSession, type TurnPlan } from './session';

/**
 * A whole task through the session, as the editor runs it: a scripted model,
 * real files in a scratch folder, and (where this computer has one) a real
 * browser for the page check.
 */

let root: string;
let previews: PagePreviews;

beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'fac-session-'));
    previews = new PagePreviews();
});

afterEach(async () => {
    previews.dispose();
    await rm(root, { recursive: true, force: true });
});

function start(script: Step[], options: { tokenLimit?: number } = {}) {
    const posted: ToWebview[] = [];
    const provider = new ScriptedProvider(script);
    const session = new AgentSession({
        router: new ModelRouter([{ provider, model: 'fake', contextWindow: 200_000 }]),
        diffs: { set: () => undefined, clear: () => undefined } as never,
        post: (message) => posted.push(message),
        mode: () => 'auto',
        log: () => undefined,
        features: () => ({ autoRecovery: false }),
        taskTokenLimit: () => options.tokenLimit ?? 0,
        previews,
        checkPages: () => true,
    });
    const request = 'make a snake and ladder game';
    const plan: TurnPlan = {
        tier: 'deep',
        tierReason: 'test',
        pinned: false,
        notes: [],
        agentPrompt: request,
        playbooks: choosePlaybooks(request, 'deep', new Set()),
        release: false,
        correction: false,
        attachments: [],
        lessons: 0,
    };
    const notices = () => posted.filter((m): m is Extract<ToWebview, { type: 'notice' }> => m.type === 'notice').map((m) => m.message);
    const end = () => posted.find((m): m is Extract<ToWebview, { type: 'turnEnd' }> => m.type === 'turnEnd');
    return { session, provider, posted, notices, end, run: () => session.run(root, request, plan) };
}

const PAGE = '<!doctype html><title>Snake and Ladder</title><main id="app">Loading</main><script type="module" src="js/game.js"></script>';
const BROKEN = 'const squares = undefined;\nObject.entries(squares);';
const FIXED = "document.getElementById('app').textContent = 'Board ready';";

describe('a task through the session', async () => {
    const browser = await findBrowser();

    it.skipIf(!browser)(
        'sends a page that crashes back to be fixed, then finishes with a preview',
        async () => {
            const task = start([
                calls([
                    ['write_file', { path: 'snake-and-ladder/index.html', content: PAGE }],
                    ['write_file', { path: 'snake-and-ladder/js/game.js', content: BROKEN }],
                ]),
                say('The game is ready.'),
                call('write_file', { path: 'snake-and-ladder/js/game.js', content: FIXED }),
                say('Fixed: the board now draws.'),
            ]);
            await task.run();

            // Sent back with the browser's own words, file and line included.
            const sentBack = task.provider.requests[2]!.messages.at(-1)!;
            expect(sentBack.content).toContain('Not done yet: the page does not work.');
            expect(sentBack.content).toMatch(/Uncaught TypeError: .*\(js\/game\.js:2\)/);
            expect(task.notices().some((n) => n.includes('Sending it back to be fixed'))).toBe(true);
            expect(task.notices().some((n) => n.includes('snake-and-ladder/index.html in a browser: it loads with no errors'))).toBe(true);

            // Never held to a build that a plain page does not have.
            expect(task.provider.requests.flatMap((r) => r.messages).some((m) => m.content.includes('quality gates have not passed'))).toBe(false);
            const checks = task.posted.find((m): m is Extract<ToWebview, { type: 'checks' }> => m.type === 'checks');
            expect(checks?.gates.every((gate) => !gate.required)).toBe(true);

            expect(task.end()).toMatchObject({ reason: 'completed', preview: { kind: 'file', target: 'snake-and-ladder/index.html', auto: true } });
            expect(task.end()!.files.map((f) => f.path).sort()).toEqual(['snake-and-ladder/index.html', 'snake-and-ladder/js/game.js']);
            expect(await readFile(path.join(root, 'snake-and-ladder', 'js', 'game.js'), 'utf8')).toBe(FIXED);
            expect(task.provider.remaining).toBe(0);
            expect(task.session.running).toBe(false);
        },
        120_000,
    );

    it.skipIf(!browser)(
        'tells the user when the page is still broken after the agent’s last word',
        async () => {
            // Sent back twice (the most a task allows), and it never fixes the crash.
            const task = start([
                calls([
                    ['write_file', { path: 'game/index.html', content: PAGE }],
                    ['write_file', { path: 'game/js/game.js', content: BROKEN }],
                ]),
                say('Done.'),
                call('write_file', { path: 'game/js/game.js', content: `${BROKEN}\n// tried` }),
                say('Done now.'),
                call('write_file', { path: 'game/js/game.js', content: `${BROKEN}\n// tried again` }),
                say('Really done.'),
            ]);
            await task.run();
            expect(task.end()).toMatchObject({ reason: 'completed' });
            expect(task.notices().at(-1)).toContain('game/index.html still does not work in a browser');
        },
        180_000,
    );

    it('says so when files it wrote are gone by the end', async () => {
        const task = start([
            calls([
                ['write_file', { path: 'notes/keep.md', content: 'kept' }],
                ['write_file', { path: 'notes/lost.md', content: 'lost' }],
            ]),
            () => {
                // Something outside the agent removes a file it wrote.
                unlinkSync(path.join(root, 'notes', 'lost.md'));
                return { role: 'assistant', content: 'Done.' };
            },
        ]);
        await task.run();
        expect(task.notices().some((n) => n.startsWith('1 of the 2 files this task wrote is no longer on disk (notes/lost.md)'))).toBe(true);
    });

    it('pauses at the token limit and says how to carry on', async () => {
        const task = start([call('list_dir', {}), say('never reached')], { tokenLimit: 1 });
        await task.run();
        expect(task.end()).toMatchObject({ reason: 'budget', steps: 1 });
        expect(task.notices().some((n) => n.startsWith('Paused after '))).toBe(true);
        expect(task.provider.remaining).toBe(1);
    });
});
