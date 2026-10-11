import { describe, expect, it } from 'vitest';
import { QUICK_TOOLS, READ_TOOLS, toolsFor } from './toolsets';

describe('toolsFor', () => {
    it('gives each kind of task only the tools it uses', () => {
        expect(toolsFor({ tier: 'fast', general: true })).toEqual([]);
        expect(toolsFor({ tier: 'deep', explain: true })).toEqual(READ_TOOLS);
        expect(toolsFor({ tier: 'fast' })).toEqual(QUICK_TOOLS);
        expect(toolsFor({ tier: 'deep' })).toBeUndefined();
        expect(toolsFor({ tier: 'deep', test: true, general: true })).toBeUndefined();
        const build = toolsFor({ tier: 'deep', newBuild: true })!;
        expect(build).toContain('write_file');
        expect(build).toContain('check_page');
        expect(build).not.toContain('search_code');
    });
});
