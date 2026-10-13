import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkDocx, checkPptx } from './docCheck';

const fixture = (name: string) => new Uint8Array(readFileSync(path.join(__dirname, 'fixtures', name)));

describe('check_document', () => {
    it('finds empty placeholders, empty slides and tiny text in a deck', () => {
        const report = checkPptx(fixture('bad.pptx'));
        expect(report.summary).toMatch(/^3 slides/);
        expect(report.problems.join('\n')).toMatch(/empty content placeholder/);
        expect(report.problems.join('\n')).toMatch(/Slide 2 is nearly empty/);
        expect(report.problems.join('\n')).toMatch(/under 12 pt/);
    });

    it('passes a well-made deck and document', () => {
        expect(checkPptx(fixture('review.pptx')).problems).toEqual([]);
        expect(checkDocx(fixture('falcon.docx')).problems).toEqual([]);
    });

    it('finds blank-paragraph spacing and leftover placeholder text in a document', () => {
        const problems = checkDocx(fixture('bad.docx')).problems.join('\n');
        expect(problems).toMatch(/Lorem ipsum/);
        expect(problems).toMatch(/empty paragraphs \(up to 5 in a row\)/);
    });
});
