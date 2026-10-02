import { describe, expect, it } from 'vitest';
import { editNote, introduced, listProblems, type Problem } from './problems';

const p = (line: number, message: string, severity: Problem['severity'] = 'error'): Problem => ({
    file: 'src/app.ts',
    line,
    column: 3,
    severity,
    message,
    source: 'ts',
    code: '2322',
});

describe('editor problems', () => {
    it('counts only what an edit introduced, even when lines moved', () => {
        const before = [p(10, "Type 'string' is not assignable to type 'number'.")];
        const after = [p(14, "Type 'string' is not assignable to type 'number'."), p(20, "Cannot find name 'foo'.")];
        expect(introduced(before, after).map((x) => x.message)).toEqual(["Cannot find name 'foo'."]);
    });

    it('counts a repeated message once more each time it appears again', () => {
        const same = "Cannot find name 'foo'.";
        expect(introduced([p(1, same)], [p(1, same), p(5, same)])).toHaveLength(1);
    });

    it('lists errors before warnings and caps the list', () => {
        const text = listProblems([p(9, 'unused', 'warning'), p(3, 'broken'), p(1, 'also broken')], 2);
        expect(text.split('\n')).toEqual(['src/app.ts:1:3 error (ts 2322): also broken', 'src/app.ts:3:3 error (ts 2322): broken', '… and 1 more.']);
    });

    it('says nothing when the edit left no errors', () => {
        expect(editNote([], true)).toBeUndefined();
        const note = editNote([p(4, 'broken')], true)!;
        expect(note).toContain('1 new error in the changed file:');
        expect(note).toContain('src/app.ts:4:3');
    });
});
