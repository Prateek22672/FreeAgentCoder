import { describe, expect, it } from 'vitest';
import { checkPptx } from './docCheck';
import { buildDeck, deckProblems, fitFont, type DeckSpec } from './deck';

const deck = (slides: DeckSpec['slides']): DeckSpec => ({ path: 'a.pptx', title: 'Is AI an advantage for humans?', slides });

describe('make_deck refuses an outline that would make a weak deck', () => {
    it('does not chart made-up figures (a real deck charted invented "impact scores")', () => {
        const { errors } = deckProblems(
            deck([{ layout: 'chart', title: 'AI impact areas', chart: { type: 'column', categories: ['Healthcare', 'Education'], series: [{ name: 'Impact score', values: [85, 78] }] } }]),
        );
        expect(errors.join(' ')).toMatch(/source: where the figures come from.*use cards or two_columns/);
    });

    it('keeps slides short and the data consistent', () => {
        const { errors } = deckProblems(
            deck([
                { layout: 'bullets', title: 'Too much', points: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
                { layout: 'chart', title: 'Mismatch', source: 'WEF 2025', chart: { type: 'bar', categories: ['a', 'b', 'c'], series: [{ name: 's', values: [1, 2] }] } },
                { layout: 'cards', title: 'One card', cards: [{ heading: 'only', text: 'one' }] },
            ]),
        );
        expect(errors.filter((e) => !e.includes('is written like this'))).toEqual([
            expect.stringContaining('7 points; at most 6'),
            expect.stringContaining('needs one number for each of the 3 categories'),
            expect.stringContaining('needs 2 to 4 cards'),
        ]);
    });

    it('advises varied layouts and a picture', () => {
        const { advice } = deckProblems(deck([1, 2, 3, 4].map((i) => ({ layout: 'bullets' as const, title: `Slide ${i}`, points: ['a'] }))));
        expect(advice.join(' ')).toMatch(/all use bullets: vary the layouts/);
        expect(advice.join(' ')).toMatch(/find_image/);
    });
});

describe('the deck it builds', () => {
    it('sizes text to fit its box', () => {
        expect(fitFont(['short'], 6, 4, 24, 14)).toBe(24);
        expect(fitFont([Array(40).fill('a long sentence of words').join(' ')], 6, 2, 24, 14)).toBe(14);
    });

    it('is a widescreen deck with every layout, a native chart and labelled frames for missing pictures', async () => {
        const spec = deck([
            { layout: 'title', subtitle: 'Both sides, then a verdict' },
            { layout: 'cards', title: 'Where we meet AI', cards: [{ heading: 'Health', text: 'Reads scans' }, { heading: 'Work', text: 'Routine tasks' }, { heading: 'Learning', text: 'Tutoring' }] },
            { layout: 'two_columns', title: 'It cuts both ways', left: { heading: 'Advantages', points: ['Earlier diagnosis'] }, right: { heading: 'Disadvantages', points: ['Bias'] } },
            { layout: 'big_number', title: 'Work feels it first', number: '40%', label: 'of jobs are exposed to AI', source: 'IMF, January 2024' },
            { layout: 'chart', title: 'More jobs created than lost', chart: { type: 'column', categories: ['Created', 'Displaced'], series: [{ name: 'Millions', values: [170, 92] }] }, takeaway: 'A net gain of 78 million', source: 'WEF Future of Jobs Report 2025' },
            { layout: 'timeline', title: 'How AI got here', steps: [{ label: '1956', text: 'Dartmouth' }, { label: '1997', text: 'Deep Blue' }, { label: '2022', text: 'ChatGPT' }] },
            { layout: 'bullets', title: 'Rules, not panic', points: ['Test for bias'], imageNote: 'people reviewing an AI system' },
            { layout: 'quote', quote: 'A quote', by: 'Someone' },
            { layout: 'takeaways', title: 'It depends on us', points: ['One', 'Two'] },
            { layout: 'sources', items: ['IMF 2024', 'WEF 2025'] },
        ]);
        expect(deckProblems(spec).errors).toEqual([]);
        const { bytes, missing } = await buildDeck(spec, '.');
        expect(missing).toEqual(['people reviewing an AI system']);
        const report = checkPptx(bytes);
        expect(report.summary).toMatch(/^10 slides, .* 13\.33 × 7\.50 in$/);
        expect(report.problems).toEqual([]);
    });
});

describe('Gamma-style layouts', () => {
    it('checks tables, steps and galleries before building', () => {
        const { errors } = deckProblems(
            deck([
                { layout: 'table', title: 'Risks', table: { columns: ['Risk', 'Remedy'], rows: [['Bias', 'Test it', 'extra']] } },
                { layout: 'steps', title: 'Steps', steps: [{ text: 'no heading' }] },
                { layout: 'gallery', title: 'Examples', gallery: [{ heading: 'One', text: 'only one' }] },
                { layout: 'quote', quote: 'Words', title: 'q' },
            ]),
        );
        expect(errors.join('\n')).toMatch(/row 1 has 3 cells for 2 columns/);
        expect(errors.join('\n')).toMatch(/needs 2 to 6 steps/);
        expect(errors.join('\n')).toMatch(/needs 2 to 4 gallery items/);
        expect(errors.join('\n')).toMatch(/by: who said it/);
    });

    it('builds pictures that fill a side, icon cards, tables, steps, galleries and a closing slide without layout problems', async () => {
        const spec = deck([
            { layout: 'title', imageNote: 'a person and a robot shaking hands', label: 'Debate' },
            { layout: 'cards', subtitle: 'Where we meet it', title: 'AI is already everywhere', cards: [{ icon: 'stethoscope', heading: 'Health', text: 'Reads scans earlier' }, { icon: 'briefcase', heading: 'Work', text: 'Routine tasks' }, { icon: 'nope', heading: 'Learning', text: 'Tutoring' }, { heading: 'Life', text: 'Maps' }] },
            { layout: 'table', title: 'Risks have remedies', table: { columns: ['Risk', 'Problem', 'Remedy'], rows: [['Bias', 'Unfair patterns', 'Test first'], ['Privacy', 'Data collected', 'User control']] } },
            { layout: 'steps', title: 'Four choices', steps: [{ heading: 'Rules', text: 'Laws' }, { heading: 'Skills', text: 'Retraining' }], imageNote: 'a classroom', callout: 'Final thought: it is up to us.' },
            { layout: 'gallery', title: 'Three examples', gallery: [{ heading: 'A', text: 'a', imageNote: 'one' }, { heading: 'B', text: 'b', imageNote: 'two' }, { heading: 'C', text: 'c', imageNote: 'three' }] },
            { layout: 'closing', title: 'AI is an advantage when people steer it.', subtitle: 'Thank you' },
        ]);
        spec.theme = 'editorial';
        expect(deckProblems(spec).errors).toEqual([]);
        expect(deckProblems(spec).advice.join(' ')).toMatch(/there is no icon "nope"/);
        const { bytes, missing } = await buildDeck(spec, '.');
        expect(missing).toEqual(['a person and a robot shaking hands', 'a classroom', 'one', 'two', 'three']);
        expect(checkPptx(bytes).problems).toEqual([]);
    });
});

describe('outlines with the slips a real model made', () => {
    it('puts gallery items written as items, a missing label, timeline strings and plain columns right', async () => {
        const { repairDeck } = await import('./deck');
        const fixed = repairDeck({
            path: 'a.pptx',
            title: 'AI',
            slides: [
                { layout: 'gallery', title: 'Healthcare', items: [{ title: 'Scans', description: 'Read in seconds' }, { title: 'Drugs', description: 'Found faster' }] },
                { layout: 'big_number', title: 'Verdict', number: 40, detail: 'Of jobs are exposed. Some gain.', source: 'IMF 2024' },
                { type: 'history', title: 'How AI got here', points: ['1956: Dartmouth', '1997: Deep Blue', '2022: ChatGPT'] },
                { layout: 'comparison', title: 'Both sides', left: ['Faster diagnosis'], right: ['Bias'] },
                { layout: 'cards', title: 'Where', points: ['Health: reads scans', 'Work: routine tasks'] },
                { layout: 'sources', items: [{ title: 'IMF', url: 'imf.org' }] },
            ],
        }) as unknown as DeckSpec;
        expect(deckProblems(fixed).errors).toEqual([]);
        expect(fixed.slides[0]!.gallery![0]).toMatchObject({ heading: 'Scans', text: 'Read in seconds' });
        expect(fixed.slides[1]!.label).toBe('Of jobs are exposed.');
        expect(fixed.slides[2]).toMatchObject({ layout: 'timeline', steps: [{ label: '1956', text: 'Dartmouth' }, { label: '1997', text: 'Deep Blue' }, { label: '2022', text: 'ChatGPT' }] });
        expect(fixed.slides[3]!.left).toEqual({ heading: 'Advantages', points: ['Faster diagnosis'] });
        expect(fixed.slides[5]!.items).toEqual(['IMF: imf.org']);
    });

    it('shows how a slide is written when it still cannot be built', () => {
        const { errors } = deckProblems(deck([{ layout: 'gallery', title: 'Only one', gallery: [{ heading: 'x', text: 'y' }] }]));
        expect(errors.join('\n')).toContain('Slide 1 is written like this: { layout: "gallery", title, gallery: [{ heading, text, image }] }');
    });
});
