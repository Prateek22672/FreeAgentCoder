import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRoster } from './roster';

/** The admin's Models page reads this file; it is generated from the routing code, never written by hand. */
const SITE_COPY = path.resolve(__dirname, '../../../apps/brain/lib/roster.json');

describe('the roster behind the admin Models page', () => {
    it('describes every role from the real routing constants', () => {
        const roster = buildRoster();
        const ids = roster.map((r) => r.id);
        expect(ids).toEqual(expect.arrayContaining(['chat', 'fyx', 'quick', 'explain', 'build', 'change', 'fix', 'design', 'refactor', 'data', 'documents', 'correction', 'reader', 'pdf', 'lessons']));
        const quick = roster.find((r) => r.id === 'quick')!;
        expect(quick.chain[0]!.provider).toBe('groq');
        expect(quick.tools.names).toContain('edit_file');
        expect(quick.tools.names).not.toContain('find_image');
        const build = roster.find((r) => r.id === 'build')!;
        expect(build.chain[0]!.provider).toBe('gemini');
        expect(build.chain[0]!.models[0]).toMatch(/^gemini-/);
        expect(roster.find((r) => r.id === 'chat')!.tools.count).toBe(0);
        expect(roster.find((r) => r.id === 'documents')!.tools.names).toEqual(expect.arrayContaining(['find_image', 'check_document']));
        expect(roster.find((r) => r.id === 'fix')!.approach.length).toBeGreaterThan(2);
    });

    it('matches the copy the admin page uses (regenerate with UPDATE_ROSTER=1)', () => {
        const fresh = `${JSON.stringify(buildRoster(), null, 2)}\n`;
        if (process.env.UPDATE_ROSTER) {
            writeFileSync(SITE_COPY, fresh, 'utf8');
        }
        expect(readFileSync(SITE_COPY, 'utf8').replace(/\r\n/g, '\n')).toBe(fresh);
    });
});
