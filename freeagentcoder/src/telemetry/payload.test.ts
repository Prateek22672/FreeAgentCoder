import { describe, expect, it } from 'vitest';
import { addFailure, buildReport, emptyCounters, type ReportInput } from './payload';

const input = (over: Partial<ReportInput> = {}): ReportInput => ({
    install: '0f1b0c2e-0000-4000-8000-000000000000',
    extension: '0.3.0',
    editor: '1.137.0',
    platform: 'win32',
    since: Date.UTC(2026, 0, 1),
    now: Date.UTC(2026, 0, 8),
    providers: ['gemini', 'groq'],
    keyCount: 2,
    counters: emptyCounters(),
    ...over,
});

describe('what a report may contain', () => {
    it('counts keys and providers, never a key', () => {
        const report = buildReport(input({ providers: ['Gemini', 'gemini', 'groq'], keyCount: 3 }));
        expect(report.keys).toEqual({ count: 3, providers: ['gemini', 'groq'] });
        expect(JSON.stringify(report)).not.toMatch(/AIza|sk-|gsk_/);
    });

    it('carries no project, file or prompt text', () => {
        const counters = emptyCounters();
        addFailure(counters, 'gemini:daily-limit');
        const text = JSON.stringify(buildReport(input({ counters })));
        for (const field of Object.keys(JSON.parse(text))) {
            expect(['v', 'install', 'extension', 'editor', 'platform', 'days', 'keys', 'counters']).toContain(field);
        }
    });

    it('measures the period it covers in days', () => {
        expect(buildReport(input()).days).toBe(7);
        expect(buildReport(input({ since: Date.UTC(2026, 0, 8) })).days).toBe(1);
    });
});

describe('recording why tasks failed', () => {
    it('keeps a short cause and counts repeats', () => {
        const counters = emptyCounters();
        addFailure(counters, 'gemini:daily-limit');
        addFailure(counters, 'gemini:daily-limit');
        expect(counters.failures).toEqual({ 'gemini:daily-limit': 2 });
    });

    it('drops anything that is not a plain cause, so a message can never leak into one', () => {
        const counters = emptyCounters();
        addFailure(counters, 'Error reading C:/Users/me/secret-project/src/app.ts');
        addFailure(counters, 'failed: "let me fix the billing bug"');
        expect(counters.failures).toEqual({});
    });

    it('stops collecting new causes once there are plenty', () => {
        const counters = emptyCounters();
        for (let i = 0; i < 30; i += 1) {
            addFailure(counters, `cause-${i}`);
        }
        expect(Object.keys(counters.failures)).toHaveLength(20);
        addFailure(counters, 'cause-0');
        expect(counters.failures['cause-0']).toBe(2);
    });
});
