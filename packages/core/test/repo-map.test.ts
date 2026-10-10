import { describe, expect, it } from 'vitest';
import { formatRepoMap, importedNames } from '../src/node/repo-map';

describe('repo map', () => {
  it('reads imports in several languages', () => {
    expect(importedNames("import { db } from './lib/db';\nconst x = require('../util/format');")).toEqual(['db', 'format']);
    expect(importedNames('from app.services.crm import CrmService\nimport os\n')).toEqual(['crm', 'os']);
    expect(importedNames('using SmartSales.Services;\n')).toEqual(['services']);
  });

  it('puts the most-imported files and entry points first, with their definitions, within the budget', () => {
    const files = [
      { path: 'src/components/Button.tsx', text: "import { cn } from '../lib/cn';\nexport function Button() {}\n" },
      { path: 'src/pages/Home.tsx', text: "import { Button } from '../components/Button';\nimport { cn } from '../lib/cn';\nexport default function Home() {}\n" },
      { path: 'src/lib/cn.ts', text: 'export function cn(...parts: string[]) {}\nexport const join = 1;\n' },
      { path: 'src/main.tsx', text: "import Home from './pages/Home';\nfunction start() {}\n" },
      { path: 'src/lib/cn.test.ts', text: "import { cn } from './cn';\n" },
    ];
    const map = formatRepoMap(files, 4_000);
    const order = map.split('\n').filter((l) => !l.startsWith(' ')).map((l) => l.split(' ')[0]);
    expect(order[0]).toBe('src/lib/cn.ts');
    expect(order.at(-1)).toBe('src/lib/cn.test.ts');
    expect(map).toContain('src/lib/cn.ts (used by 3)');
    expect(map).toContain('function cn(...parts: string[])');
    expect(formatRepoMap(files, 60).split('\n').length).toBeLessThan(4);
  });

  it('says nothing for a tiny project', () => {
    expect(formatRepoMap([{ path: 'index.html', text: '' }])).toBe('');
  });
});
