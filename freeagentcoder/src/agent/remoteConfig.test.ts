import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: () => true }) } }));

const { enabledSpecialists, parseConfig, parseReferences } = await import('./remoteConfig');

describe('specialist settings from the admin page', () => {
    it('keeps valid overrides', () => {
        const config = parseConfig({ specialists: { fix: { enabled: true, extra: 'Run the e2e suite.', model: 'gemini:gemini-3.8-flash' } } });
        expect(config.fix).toEqual({ enabled: true, extra: 'Run the e2e suite.', model: 'gemini:gemini-3.8-flash' });
    });

    it('drops a model that is not provider:model', () => {
        expect(parseConfig({ specialists: { fix: { model: 'https://evil.example/v1' } } }).fix?.model).toBe('');
        expect(parseConfig({ specialists: { fix: { model: 'gemini' } } }).fix?.model).toBe('');
        expect(parseConfig({ specialists: { fix: { model: 'madeup:model-x' } } }).fix?.model).toBe('');
        expect(parseConfig({ specialists: { fix: { model: 'openrouter:qwen/qwen3-coder' } } }).fix?.model).toBe('openrouter:qwen/qwen3-coder');
    });

    it('caps and cleans the extra instructions, which reach the agent', () => {
        const extra = parseConfig({ specialists: { build: { extra: `a\u0000b${'x'.repeat(5_000)}` } } }).build!.extra;
        expect(extra.startsWith('ab')).toBe(true);
        expect(extra.length).toBeLessThanOrEqual(1_500);
    });

    it('ignores ids that are not specialists, and garbage', () => {
        expect(parseConfig({ specialists: { root: { enabled: true } } })).toEqual({});
        expect(parseConfig('nonsense')).toEqual({});
        expect(parseConfig(undefined)).toEqual({});
    });

    it('treats every specialist as on unless it is explicitly switched off', () => {
        expect(enabledSpecialists({}).size).toBe(6);
        const enabled = enabledSpecialists(parseConfig({ specialists: { design: { enabled: false } } }));
        expect(enabled.has('design')).toBe(false);
        expect(enabled.has('fix')).toBe(true);
    });
});

describe('the reference library download', () => {
    it('keeps valid entries and drops malformed ones', () => {
        const parsed = parseReferences([
            { id: 'crm', kind: 'blueprint', name: 'CRM', tags: ['crm', 'asp.net'], points: ['Audit in SaveChangesAsync.'] },
            { id: 'bad', kind: 'script', name: 'x', tags: ['x'], points: ['run this'] },
            { id: 'empty', kind: 'design', name: 'No rules', tags: ['a'], points: [] },
            'not an object',
        ]);
        expect(parsed.map((r) => r.id)).toEqual(['crm']);
        expect(parseReferences({ not: 'a list' })).toEqual([]);
    });
});

describe('what every user taught, from the download', () => {
    it('keeps valid lessons, chores and providers, and drops the rest', async () => {
        const { parseFleetLearned } = await import('./remoteConfig');
        const learned = parseFleetLearned({
            lessons: [{ text: 'Write the PDF in the same script; LibreOffice is rarely installed.', stack: 'Python' }, { text: 'short' }],
            fyx: [{ pattern: 'zip the {name} folder', command: 'tar -a -c -f {name}.zip {name}' }, { pattern: '<script>', command: 'x' }],
            order: { deep: ['nvidia', 'gemini', 'evil'], fast: 'groq' },
        });
        expect(learned.lessons).toEqual([{ text: 'Write the PDF in the same script; LibreOffice is rarely installed.', stack: 'python' }]);
        expect(learned.fyx).toHaveLength(1);
        expect(learned.order).toEqual({ deep: ['nvidia', 'gemini'], fast: undefined });
    });
});
