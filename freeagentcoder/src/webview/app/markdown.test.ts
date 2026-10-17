import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('links to an app on this computer', () => {
    it('get an Open button beside them, so they are hard to miss', () => {
        const html = renderMarkdown('Open http://127.0.0.1:8080 in your browser.');
        expect(html).toContain('<a href="http://127.0.0.1:8080" data-external="1">http://127.0.0.1:8080</a> <a class="open-link"');
        expect(renderMarkdown('[the app](http://localhost:5173/)')).toContain('class="open-link"');
    });

    it('other links stay plain', () => {
        expect(renderMarkdown('See https://flutter.dev for more.')).not.toContain('open-link');
    });
});
