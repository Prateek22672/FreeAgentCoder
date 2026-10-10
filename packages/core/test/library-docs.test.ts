import { describe, expect, it } from 'vitest';
import { formatDocs, pickLibrary } from '../src/node/library-docs';

describe('library_docs', () => {
  it('picks the best-documented library and formats snippets', () => {
    const picked = pickLibrary(
      [
        { id: 'not-an-id', title: 'junk' },
        { id: '/websites/docs_python_3', title: 'Python 3 docs', trustScore: 10, benchmarkScore: 95 },
        { id: '/scanny/python-pptx', title: 'Python-pptx', trustScore: 8.4, benchmarkScore: 78 },
      ],
      'python-pptx',
    );
    expect(picked?.id).toBe('/scanny/python-pptx');
    const text = formatDocs(picked!, {
      codeSnippets: [{ codeTitle: 'Set fill colour', codeList: [{ code: 'shape.fill.solid()\nshape.fill.fore_color.rgb = RGBColor(255, 0, 0)' }] }],
      infoSnippets: [{ content: 'RGBColor takes three integers from 0 to 255.' }],
    }, 6000);
    expect(text).toContain('RGBColor(255, 0, 0)');
    expect(text).toContain('three integers');
  });
});
