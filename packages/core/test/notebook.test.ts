import { describe, expect, it } from 'vitest';
import { renderNotebook } from '../src/tools/read';

describe('renderNotebook', () => {
  it('shows cells in order and hides bulky outputs', () => {
    const notebook = JSON.stringify({
      metadata: { language_info: { name: 'python' } },
      cells: [
        { cell_type: 'markdown', source: ['# Training\n', 'Fit a model.'] },
        { cell_type: 'code', source: 'import torch\nmodel = torch.nn.Linear(4, 2)\n', outputs: [{ data: { 'image/png': 'iVBORw0KGgo'.repeat(500) } }] },
      ],
    });
    const view = renderNotebook(notebook)!;
    expect(view).toContain('2 cells');
    expect(view).toContain('# %% [markdown] cell 1\n# Training\nFit a model.');
    expect(view).toContain('# %% [code] cell 2 (1 output hidden)\nimport torch');
    expect(view).not.toContain('iVBORw0KGgo');
  });

  it('returns null for JSON that is not a notebook', () => {
    expect(renderNotebook('{"name": "x"}')).toBeNull();
    expect(renderNotebook('not json')).toBeNull();
  });
});
