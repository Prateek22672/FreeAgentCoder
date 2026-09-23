import { describe, expect, it } from 'vitest';
import { isUsable, tidy } from './ocr';

describe('tidying what the reader returned', () => {
    it('puts typographic quotes back to the ones code uses', () => {
        expect(tidy('throw new Error(\u201Cupgrade required\u201D)')).toBe('throw new Error("upgrade required")');
        expect(tidy("type \u2018string | undefined\u2019")).toBe(`type 'string | undefined'`);
    });

    it('closes the gap the reader leaves before a file extension', () => {
        expect(tidy('src/components/BillingForm. tsx:42:18')).toBe('src/components/BillingForm.tsx:42:18');
        expect(tidy('app/main. py and styles. css')).toBe('app/main.py and styles.css');
    });

    it('leaves ordinary sentences alone', () => {
        expect(tidy('The build failed. Run it again.')).toBe('The build failed. Run it again.');
    });

    it('trims trailing spaces and runs of blank lines', () => {
        expect(tidy('one   \n\n\n\ntwo')).toBe('one\n\ntwo');
    });
});

describe('deciding whether a reading is good enough', () => {
    const page = (text: string, confidence: number) => ({ name: 'a.png', text, confidence });

    it('accepts a confident reading with enough text', () => {
        expect(isUsable(page('TS2345: Argument of type string is not assignable', 82))).toBe(true);
    });

    it('rejects a few stray characters, however confident', () => {
        expect(isUsable(page('OK', 99))).toBe(false);
    });

    it('rejects a long but unconfident reading, so a model is asked instead', () => {
        expect(isUsable(page('a page of mostly guessed characters, at length', 41))).toBe(false);
    });
});
