import { describe, expect, it } from 'vitest';
import { QUICK_TOOLS, READ_TOOLS, toolsFor } from './toolsets';

describe('toolsFor', () => {
    it('gives each kind of task only the tools it uses', () => {
        expect(toolsFor({ tier: 'fast', general: true })).toEqual([]);
        expect(toolsFor({ tier: 'deep', explain: true })).toEqual(READ_TOOLS);
        expect(toolsFor({ tier: 'fast' })).toEqual(QUICK_TOOLS);
        const change = toolsFor({ tier: 'deep' })!;
        expect(change).toContain('search_code');
        expect(change).not.toContain('find_image');
        expect(toolsFor({ tier: 'deep', test: true, general: true })).toBeUndefined();
        const build = toolsFor({ tier: 'deep', newBuild: true })!;
        expect(build).toContain('write_file');
        expect(build).toContain('check_page');
        expect(build).not.toContain('search_code');
    });

    it('adds the image and document tools only where the result is visual', () => {
        expect(toolsFor({ tier: 'deep', newBuild: true, documents: true })).toEqual(expect.arrayContaining(['find_image', 'check_document']));
        expect(toolsFor({ tier: 'deep', newBuild: true, visual: true })).toContain('find_image');
        expect(toolsFor({ tier: 'deep', newBuild: true, visual: true })).not.toContain('check_document');
        expect(toolsFor({ tier: 'fast' })).not.toContain('find_image');
    });
});

describe('a presentation task', () => {
    it('gets only what make_deck needs: no scripts, no commands, no docs lookups', async () => {
        const { DECK_TOOLS } = await import('./toolsets');
        expect(toolsFor({ tier: 'deep', newBuild: true, documents: true, deck: true })).toEqual(DECK_TOOLS);
        expect(DECK_TOOLS).not.toContain('write_file');
        expect(DECK_TOOLS).not.toContain('run_command');
        expect(DECK_TOOLS).toEqual(expect.arrayContaining(['find_image', 'make_deck']));
    });
});

