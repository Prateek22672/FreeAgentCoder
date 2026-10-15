import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { aggregateKinds, isShareablePattern, isShareableRule, learnedOrder, parseLearning, ruleHash } = await import('../lib/learning');

const install = '0b5f3c1e-7a2d-4c8e-9f10-123456789abc';

describe('what installs may share', () => {
    it('keeps general rules and refuses anything about one person or project', () => {
        expect(isShareableRule('python-pptx takes RGBColor values from 0 to 255; matplotlib takes hex strings.')).toBe(true);
        expect(isShareableRule('Use pnpm, not npm, for installs.')).toBe(true);
        expect(isShareableRule('Edit C:\\Users\\prateek\\Desktop\\py\\build.py first')).toBe(false);
        expect(isShareableRule('The API lives in src/server/routes/users.ts')).toBe(false);
        expect(isShareableRule('Deploy to https://my-company.internal')).toBe(false);
        expect(isShareableRule('Email reports to ravi@example.com')).toBe(false);
        expect(isShareableRule('api_key = sk-proj-abcdefghijklmnopqrstuvwxyz123')).toBe(false);
    });

    it('keeps chore patterns only once every name is replaced', () => {
        expect(isShareablePattern('zip the {folder} folder', 'tar -a -c -f {folder}.zip {folder}')).toBe(true);
        expect(isShareablePattern('push to {branch}', 'git push origin {branch}')).toBe(true);
        expect(isShareablePattern('zip my files', 'tar -a -c -f /home/ravi/secret.zip /home/ravi')).toBe(false);
    });

    it('parses a report, dropping malformed and personal items', () => {
        const report = parseLearning({
            v: 1,
            install,
            extension: '0.6.1',
            outcomes: [
                { kind: 'build', tier: 'deep', provider: 'gemini', model: 'gemini-3.8-flash', completed: true, steps: 7, tokens: 41000, durationMs: 90000 },
                { kind: 'build', tier: 'huge' },
            ],
            feedback: [{ kind: 'build', provider: 'gemini', model: 'gemini-3.8-flash', good: false, reasons: ['did-not-run', 'made-up-reason'] }],
            lessons: [{ text: 'Write the PDF in the same script; LibreOffice is rarely installed.', stack: 'python' }, { text: 'Look in D:\\work\\acme\\api first' }],
            errors: [{ signature: 'run_command: ValueError: RGBA values should be within #-# range', tool: 'run_command', count: 3, repeats: 2 }],
            fyx: [{ pattern: 'zip the {folder} folder', command: 'tar -a -c -f {folder}.zip {folder}' }],
        })!;
        expect(report.outcomes).toHaveLength(1);
        expect(report.outcomes[0]).toMatchObject({ completed: true, steps: 7, corrected: false });
        expect(report.feedback[0]!.reasons).toEqual(['did-not-run']);
        expect(report.lessons.map((l) => l.stack)).toEqual(['python']);
        expect(report.errors[0]!.repeats).toBe(2);
        expect(report.fyx).toHaveLength(1);
        expect(parseLearning({ v: 1, install: 'not an id' })).toBeUndefined();
    });

    it('merges the same rule however it is spelled', () => {
        expect(ruleHash('Use pnpm, not npm.')).toBe(ruleHash('use PNPM not npm'));
    });
});

describe('learned model order', () => {
    const score = (provider: string, tasks: number, completed: number, extra: Partial<{ corrected: number; bad: number; good: number; avg_steps: number }> = {}) => ({
        tier: 'deep' as const,
        provider,
        model: 'm',
        tasks,
        completed,
        corrected: extra.corrected ?? 0,
        avg_steps: extra.avg_steps ?? 8,
        avg_tokens: 30000,
        good: extra.good ?? 0,
        bad: extra.bad ?? 0,
    });

    it('ranks providers by finished, uncorrected, liked tasks, and only with enough evidence', () => {
        const order = learnedOrder([score('gemini', 40, 30, { corrected: 6 }), score('nvidia', 30, 28), score('groq', 5, 5), score('openrouter', 50, 50)]);
        expect(order.deep).toEqual(['nvidia', 'gemini']);
        expect(order.fast).toBeUndefined();
    });
});

describe('outcomes by kind of work', () => {
    it('groups rows by kind with rates, averages and the models that answered', () => {
        const row = (kind: string, provider: string, model: string, completed: boolean, steps: number) => ({ kind, provider, model, completed, corrected: false, paused: false, steps, tokens: steps * 1000, duration_ms: steps * 2000 });
        const out = aggregateKinds([row('fix', 'gemini', 'g', true, 6), row('fix', 'gemini', 'g', false, 10), row('fix', 'groq', 'o', true, 5), row('quick', 'groq', 'o', true, 1)]);
        expect(out.map((k) => k.kind)).toEqual(['fix', 'quick']);
        const fix = out[0]!;
        expect(fix).toMatchObject({ tasks: 3, completed: 2 });
        expect(fix.avgSteps).toBeCloseTo(7, 5);
        expect(fix.byModel[0]).toMatchObject({ provider: 'gemini', tasks: 2, completed: 1 });
    });
});
