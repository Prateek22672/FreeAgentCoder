import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { matchReferences, parseCondensed, readReferences, sanitizeReference } = await import('../lib/references');
const { REFERENCE_SEED } = await import('../lib/reference-seed');

describe('the reference library', () => {
    it('starts from the condensed seed', async () => {
        const list = await readReferences();
        expect(list.length).toBe(REFERENCE_SEED.length);
        expect(list.every((r) => r.points.length >= 6 && r.tags.length >= 5)).toBe(true);
    });

    it('matches a CRM spec to the ASP.NET blueprint and a dark parking dashboard to its design', () => {
        const crm = matchReferences(REFERENCE_SEED, 'Build AcxiomCRM in ASP.NET Core MVC with Identity, role based access control and audit logging', 'blueprint');
        expect(crm[0]?.name).toMatch(/ASP\.NET/);
        const parking = matchReferences(REFERENCE_SEED, 'design a smart parking dashboard with a dark industrial interface', 'design');
        expect(parking[0]?.name).toMatch(/Parking/i);
    });

    it('matches nothing for an unrelated request', () => {
        expect(matchReferences(REFERENCE_SEED, 'fix the typo in the footer', 'design')).toEqual([]);
    });

    it('drops malformed or empty entries and caps what it keeps', () => {
        expect(sanitizeReference({ id: 'x', kind: 'hack', name: 'n', tags: ['a'], points: ['p'] })).toBeUndefined();
        const kept = sanitizeReference({ id: 'Bad Id!', kind: 'docs', name: 'Doc', tags: ['react', 'react'], points: ['x'.repeat(900), 'short'] });
        expect(kept?.id).toBe('badid');
        expect(kept?.tags).toEqual(['react']);
        expect(kept?.points).toHaveLength(1);
        expect(kept?.points[0]!.length).toBe(400);
    });

    it('reads the JSON out of a model reply with text around it', () => {
        const reply = 'Here it is:\n```json\n{"name":"Calm SaaS","tags":["saas","dashboard"],"points":["Use one accent colour for actions."]}\n```';
        expect(parseCondensed(reply)).toEqual({ name: 'Calm SaaS', tags: ['saas', 'dashboard'], points: ['Use one accent colour for actions.'] });
        expect(parseCondensed('no json here')).toBeUndefined();
    });
});
