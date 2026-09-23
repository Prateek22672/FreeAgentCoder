/**
 * Regressions found by running Project Brain on real public repositories
 * (expressjs/express, fastapi/full-stack-fastapi-template). Each test pins one.
 */
import { describe, expect, it } from 'vitest';
import {
    analyzeImpact,
    analyzeRepository,
    buildImportGraph,
    buildRepoInput,
    checkCitations,
    collectDependencies,
    detectDatabases,
    detectFrameworks,
    detectImportantFiles,
    isSecretFile,
    rankHits,
    redactSecrets,
    resolveImport,
    roleOf,
    type RawEntry,
} from '../src/index';

const encoder = new TextEncoder();
const raw = (files: Record<string, string>): RawEntry[] => Object.entries(files).map(([path, text]) => ({ path, bytes: encoder.encode(text) }));

/** The shape of fastapi/full-stack-fastapi-template: manifests in sub-folders. */
const fullStack = () =>
    buildRepoInput(
        raw({
            'README.md': '# Full stack',
            'docker-compose.yml': 'services:\n  db:\n    image: postgres:17\n  backend:\n    build: ./backend',
            '.env': 'POSTGRES_PASSWORD=changethis123\nSECRET_KEY=abcdefghijk',
            'backend/pyproject.toml': [
                '[project]',
                'name = "app"',
                'dependencies = [',
                '    "fastapi[standard]<1.0.0,>=0.114.2",',
                '    "sqlmodel<1.0.0,>=0.0.21",',
                '    "psycopg[binary]<4.0.0,>=3.1.13",',
                '    "alembic<2.0.0,>=1.12.1",',
                ']',
                '',
                '[dependency-groups]',
                'dev = ["pytest<8.0.0,>=7.4.3", "mypy<2.0.0,>=1.8.0"]',
            ].join('\n'),
            'backend/app/main.py': 'from fastapi import FastAPI\nfrom app.api.main import api_router\napp = FastAPI()',
            'backend/app/models.py': 'from sqlmodel import SQLModel\nclass User(SQLModel): email: str',
            'backend/app/api/main.py': 'from app.api.routes import login\napi_router = None',
            'backend/app/api/routes/login.py': 'from app.models import User\nfrom .deps import get_db\ndef login(): return User',
            'backend/app/api/routes/deps.py': 'def get_db(): ...',
            'backend/app/api/routes/__init__.py': '',
            'backend/tests/test_login.py': 'from app.api.routes.login import login\ndef test_login(): login()',
            'frontend/package.json': JSON.stringify({ dependencies: { react: '19', '@tanstack/react-router': '1' }, devDependencies: { vite: '6', '@playwright/test': '1' } }),
            'frontend/src/client/types.gen.ts': 'export type User = { email: string };',
            'frontend/src/components/Login.tsx': "import { Button } from '@/components/ui/button';\nexport function Login() { return null; }",
            'frontend/src/components/ui/button.tsx': 'export function Button() { return null; }',
            'examples/demo/views/index.html': '<h1>demo</h1>',
        }),
    );

describe('monorepo manifests', () => {
    it('reads dependencies from nested pyproject.toml and package.json, citing each manifest', () => {
        const deps = collectDependencies(fullStack());
        const byName = new Map(deps.map((d) => [d.name, d]));
        expect(byName.get('fastapi')).toMatchObject({ kind: 'prod', ecosystem: 'pip', source: 'backend/pyproject.toml' });
        expect(byName.get('psycopg')?.kind).toBe('prod');
        expect(byName.get('pytest')?.kind).toBe('dev');
        expect(byName.get('react')?.source).toBe('frontend/package.json');
    });

    it('detects the database from the driver and from docker-compose, and the framework for certain', () => {
        const input = fullStack();
        const deps = collectDependencies(input);
        const dbs = detectDatabases(input, deps);
        const postgres = dbs.find((d) => d.value === 'PostgreSQL');
        expect(postgres?.confidence).toBe('detected');
        expect(postgres?.evidence).toEqual(expect.arrayContaining(['backend/pyproject.toml → psycopg', 'docker-compose.yml → service image']));
        expect(dbs.map((d) => d.value)).toEqual(expect.arrayContaining(['SQLModel', 'Alembic migrations']));
        expect(detectFrameworks(input, deps).find((f) => f.value === 'FastAPI')?.confidence).toBe('detected');
    });

    it('lists sub-project READMEs and manifests, and any spelling of README', () => {
        const input = buildRepoInput(raw({ 'Readme.md': '#', 'backend/pyproject.toml': '', 'frontend/package.json': '{}', 'examples/x/package.json': '{}' }));
        expect(detectImportantFiles(input)).toEqual(['Readme.md', 'backend/pyproject.toml', 'frontend/package.json']);
    });
});

describe('import resolution', () => {
    const input = fullStack();
    const files = new Set(input.files.map((f) => f.path));

    it('resolves Python absolute imports against the source root, not the repo root', () => {
        expect(resolveImport('backend/app/api/routes/login.py', 'app.models', files)).toBe('backend/app/models.py');
        expect(resolveImport('backend/tests/test_login.py', 'app.api.routes.login', files)).toBe('backend/app/api/routes/login.py');
    });

    it('resolves Python relative imports', () => {
        expect(resolveImport('backend/app/api/routes/login.py', '.deps', files)).toBe('backend/app/api/routes/deps.py');
    });

    it('resolves the @/ alias from the nearest sub-project', () => {
        expect(resolveImport('frontend/src/components/Login.tsx', '@/components/ui/button', files)).toBe('frontend/src/components/ui/button.tsx');
    });

    it('builds reverse dependencies for Python, so impact reaches through imports', () => {
        const graph = buildImportGraph(input.files);
        expect([...(graph.in.get('backend/app/models.py') ?? [])]).toContain('backend/app/api/routes/login.py');
        const impact = analyzeImpact({ query: 'Rename User.email', input, graph, dependencies: collectDependencies(input) });
        expect(impact.dependents.map((d) => d.path)).toEqual(expect.arrayContaining(['backend/app/api/main.py']));
    });
});

describe('classification and counts', () => {
    it('keeps example code out of the product counts', () => {
        expect(roleOf('examples/demo/views/index.html')).toBe('example');
        expect(roleOf('examples/auth/index.js')).toBe('example');
        expect(roleOf('src/views/home.ejs')).toBe('component');
        expect(roleOf('public/logo.svg')).toBe('style');
        expect(roleOf('data/cities.json')).toBe('config');
    });

    it('treats generated clients as generated, so they are listed but not read', () => {
        const input = fullStack();
        expect(input.paths).toContain('frontend/src/client/types.gen.ts');
        expect(input.files.map((f) => f.path)).not.toContain('frontend/src/client/types.gen.ts');
    });

    it('makes impact groups add up to the total', () => {
        const input = fullStack();
        const impact = analyzeImpact({ query: 'Replace PostgreSQL psycopg with MongoDB', input, dependencies: collectDependencies(input) });
        expect(impact.groups.reduce((n, g) => n + g.files.length, 0)).toBe(impact.total);
    });

    it('analyzes the whole repository end to end', () => {
        const a = analyzeRepository(fullStack(), { owner: 'fastapi', repo: 'full-stack', ref: 'master', url: 'https://github.com/fastapi/full-stack' });
        expect(a.roles.example).toBe(1);
        expect(a.roles.component).toBe(2);
        expect(a.databases.map((d) => d.value)).toContain('PostgreSQL');
        expect(a.testing.map((t) => t.value)).toEqual(expect.arrayContaining(['pytest', 'Playwright']));
    });
});

describe('ranking', () => {
    const hits = [
        { path: 'CHANGELOG.md', score: 10 },
        { path: 'tests/test_login.py', score: 9 },
        { path: 'app/api/routes/login.py', score: 6 },
        { path: 'examples/login/app.py', score: 8 },
    ];

    it('puts implementation above tests, docs and examples', () => {
        expect(rankHits(hits, 'user login')[0]?.path).toBe('app/api/routes/login.py');
        expect(rankHits(hits, 'user login').at(-1)?.path).toBe('CHANGELOG.md');
    });

    it('respects a query that asks for tests or docs', () => {
        expect(rankHits(hits, 'login tests')[0]?.path).toBe('tests/test_login.py');
        expect(rankHits(hits, 'login changelog')[0]?.path).toBe('CHANGELOG.md');
    });
});

describe('framework file names in citations', () => {
    const known = new Set([
        'app/(dashboard)/dashboard/billing/page.tsx',
        'app/api/auth/[...nextauth]/route.ts',
        'app/api/posts/[postId]/route.ts',
        'app/api/posts/route.ts',
        'src/routes/+page.svelte',
        'app/routes/$userId.tsx',
    ]);

    it('verifies Next.js route groups and dynamic segments exactly, not by a lucky suffix', () => {
        const answer = 'See `app/(dashboard)/dashboard/billing/page.tsx:1-63`, app/api/auth/[...nextauth]/route.ts and `app/api/posts/[postId]/route.ts:4`.';
        const result = checkCitations(answer, known);
        expect(result.invented).toEqual([]);
        expect(result.citations.map((c) => c.path)).toEqual([
            'app/(dashboard)/dashboard/billing/page.tsx',
            'app/api/auth/[...nextauth]/route.ts',
            'app/api/posts/[postId]/route.ts',
        ]);
        expect(result.citations[0]?.lines).toEqual({ start: 1, end: 63 });
    });

    it('handles SvelteKit and Remix names, and still flags a wrong dynamic segment', () => {
        const result = checkCitations('In src/routes/+page.svelte and app/routes/$userId.tsx, not app/api/posts/[slug]/route.ts.', known);
        expect(result.citations.filter((c) => c.valid).map((c) => c.path)).toEqual(['src/routes/+page.svelte', 'app/routes/$userId.tsx']);
        expect(result.invented).toEqual(['app/api/posts/[slug]/route.ts']);
    });
});

describe('impact areas and architecture examples', () => {
    it('reports areas as folders, never as files', () => {
        const input = buildRepoInput(raw({ 'lib/db.ts': 'prisma', 'lib/auth.ts': 'prisma', 'app/api/posts/route.ts': 'prisma', 'seed.ts': 'prisma' }));
        const areas = analyzeImpact({ query: 'prisma', input }).areas.map((a) => a.name);
        expect(areas).toEqual(expect.arrayContaining(['lib', 'app/api', '(root)']));
        expect(areas.some((a) => a.endsWith('.ts'))).toBe(false);
    });

    it('picks meaningful example files for each layer', () => {
        const a = analyzeRepository(fullStack(), { owner: 'o', repo: 'r', ref: 'main', url: 'u' });
        const api = a.architecture.find((l) => l.id === 'api');
        expect(api?.examples[0]).not.toMatch(/__init__\.py$/);
    });
});

describe('secrets never reach a model', () => {
    it('recognizes real env files but not templates', () => {
        expect(isSecretFile('.env')).toBe(true);
        expect(isSecretFile('backend/.env.production')).toBe(true);
        expect(isSecretFile('.env.example')).toBe(false);
        expect(isSecretFile('src/env.ts')).toBe(false);
    });

    it('redacts keys and secret-named values but leaves normal code alone', () => {
        const text = `const gemini = "AIza${'x'.repeat(35)}";\nPOSTGRES_PASSWORD=changethis123\nSECRET_KEY: abcdefghijk\nconst port = 8000;`;
        const out = redactSecrets(text);
        expect(out).not.toContain('AIza');
        expect(out).not.toContain('changethis123');
        expect(out).not.toContain('abcdefghijk');
        expect(out).toContain('POSTGRES_PASSWORD=[redacted]');
        expect(out).toContain('const port = 8000;');
    });
});
