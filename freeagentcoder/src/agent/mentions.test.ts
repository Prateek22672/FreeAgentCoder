import { describe, expect, it } from 'vitest';
import { mentionAtCaret, mentionBlock, mentionedPaths, rankFiles } from './mentions';

describe('@-mentions', () => {
    it('finds mentioned paths, not addresses or plain @words', () => {
        expect(mentionedPaths('fix @src/app.ts and @README.md, then mail me@example.com @team')).toEqual(['src/app.ts', 'README.md']);
    });

    it('knows when the caret is in a mention', () => {
        expect(mentionAtCaret('look at @src/ap', 15)).toEqual({ start: 8, query: 'src/ap' });
        expect(mentionAtCaret('@', 1)).toEqual({ start: 0, query: '' });
        expect(mentionAtCaret('mail me@exa', 11)).toBeUndefined();
        expect(mentionAtCaret('@src/app.ts done', 16)).toBeUndefined();
    });

    it('ranks names that start with the query first', () => {
        const files = ['src/components/AppShell.tsx', 'docs/mapping.md', 'src/app.ts', 'test/app.test.ts', 'src/zapper.ts'];
        expect(rankFiles(files, 'app')).toEqual(['src/app.ts', 'test/app.test.ts', 'src/components/AppShell.tsx', 'src/zapper.ts', 'docs/mapping.md']);
        expect(rankFiles(files, 'sat')).toEqual(['src/app.ts', 'src/zapper.ts', 'test/app.test.ts', 'src/components/AppShell.tsx']);
        expect(rankFiles(files, 'zz')).toEqual([]);
    });

    it('includes whole files as read, and only part of a long one', () => {
        const short = { path: 'a.ts', content: 'const a = 1;\n' };
        const long = { path: 'b.ts', content: `${'x'.repeat(100)}\n`.repeat(500) };
        const block = mentionBlock([short, long]);
        expect(block.included).toEqual(['a.ts']);
        expect(block.text).toContain('### a.ts\n1\tconst a = 1;');
        expect(block.text).toMatch(/### b\.ts \(lines 1-\d+ of 500; read the rest with read_file\)/);
    });
});
