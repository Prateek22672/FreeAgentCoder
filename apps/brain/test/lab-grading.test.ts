import { describe, expect, it, vi } from 'vitest';
import type { LabTask, LabTurn } from '../lib/lab';

vi.mock('server-only', () => ({}));

const { autoGrade, failingSteps } = await import('../lib/lab');

const turn = (over: Partial<LabTurn> = {}): LabTurn => ({
    prompt: 'explain my project',
    reason: 'completed',
    durationMs: 9000,
    tokens: 3100,
    steps: 1,
    requests: 1,
    models: ['groq:openai/gpt-oss-120b'],
    filesChanged: [],
    usedFyx: false,
    ...over,
});

const task: LabTask = {
    id: 't',
    title: 'Explain',
    category: 'other',
    prompts: ['explain my project'],
    checklist: ['a', 'b', 'c', 'd', 'e'],
    graders: [
        { step: 0, type: 'max-steps', max: 1 },
        { step: 1, type: 'max-tokens', max: 4000 },
        { step: 2, type: 'no-changes' },
        { step: 3, type: 'command', command: 'python -m pytest -q' },
        { step: 3, type: 'no-pause' },
        { step: 4, type: 'transcript-absent', pattern: '【' },
    ],
} as LabTask;

describe('autoGrade', () => {
    it('grades the facts of a run and the command results', () => {
        const auto = autoGrade(task, [turn()], 'The app is a CRM.', [{ step: 3, passed: true, output: '4 passed' }])!;
        expect(auto.graded).toEqual([0, 1, 2, 3, 4]);
        expect(auto.passed).toEqual([0, 1, 2, 3, 4]);
        expect(auto.notes[1]).toBe('3,100 tokens');
    });

    it('fails a step when any of its graders fails, and leaves steps without a result ungraded', () => {
        const auto = autoGrade(task, [turn({ steps: 4, tokens: 9000, reason: 'paused', filesChanged: ['a.ts'] })], 'see 【3†source】', [])!;
        expect(auto.graded).toEqual([0, 1, 2, 3, 4]);
        expect(auto.passed).toEqual([]);
        const noCommand = autoGrade({ ...task, graders: [{ step: 3, type: 'command', command: 'x' }] }, [turn()], '', []);
        expect(noCommand!.graded).toEqual([]);
    });

    it('does nothing for a task without graders', () => {
        expect(autoGrade({ ...task, graders: undefined }, [turn()], '', [])).toBeUndefined();
    });
});

describe('failingSteps', () => {
    const run = (at: number, passed: number[]) => ({ id: String(at), at, taskId: 't', title: 'Explain', category: 'other', extension: '0.6.1', turns: [], auto: { graded: [0, 1], passed, notes: { 1: '9,000 tokens' } } }) as never;
    it('lists steps failed in two or more recent runs, worst first', () => {
        const now = Date.now();
        const rows = failingSteps([task], [run(now, [0]), run(now - 1000, [0]), run(now - 2000, [1]), run(now - 30 * 86_400_000, [])], 14, now);
        expect(rows).toEqual([{ taskId: 't', title: 'Explain', step: 1, text: 'b', failed: 2, graded: 3, notes: ['9,000 tokens'] }]);
    });
});
