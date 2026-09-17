import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commandVerifies, detectChecks, structureMap, type CheckKind, type ProjectCheck } from './projectChecks';

const created: string[] = [];

/** A temp project. Keys ending in "/" are empty folders; the rest are files with that content. */
async function project(files: Record<string, string>): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fac-checks-'));
    created.push(dir);
    for (const [rel, content] of Object.entries(files)) {
        const full = path.join(dir, rel);
        if (rel.endsWith('/')) {
            await fs.mkdir(full, { recursive: true });
        } else {
            await fs.mkdir(path.dirname(full), { recursive: true });
            await fs.writeFile(full, content);
        }
    }
    return dir;
}

afterEach(async () => {
    await Promise.all(created.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const pkg = (value: object) => JSON.stringify(value, null, 2);

/** `kind: command` pairs, in order. */
function summary(checks: ProjectCheck[]): string[] {
    return checks.map((c) => `${c.stack} ${c.kind}: ${c.command}`);
}

function byKind(checks: ProjectCheck[], kind: CheckKind, stack?: string): ProjectCheck {
    const found = checks.find((c) => c.kind === kind && (!stack || c.stack === stack));
    if (!found) {
        throw new Error(`no ${kind} check in ${JSON.stringify(summary(checks))}`);
    }
    return found;
}

describe('detectChecks: Node', () => {
    it('uses npm scripts for an npm + TypeScript project', async () => {
        const root = await project({
            'package.json': pkg({
                scripts: { dev: 'vite', typecheck: 'tsc --noEmit', lint: 'eslint src', test: 'vitest run', build: 'vite build' },
                devDependencies: { typescript: '^5.0.0' },
            }),
            'package-lock.json': '{}',
            'tsconfig.json': '{}',
        });
        const checks = await detectChecks(root, 'linux');
        expect(summary(checks)).toEqual(['node typecheck: npm run typecheck', 'node lint: npm run lint', 'node test: npm test', 'node build: npm run build']);
        expect(checks.map((c) => [c.label, c.cost])).toEqual([
            ['Type check', 'fast'],
            ['Lint', 'fast'],
            ['Tests', 'slow'],
            ['Build', 'slow'],
        ]);
    });

    it('picks the package manager from the lockfile', async () => {
        const scripts = { 'check-types': 'tsc', lint: 'eslint .', test: 'jest', build: 'next build' };
        const pnpm = await project({ 'package.json': pkg({ scripts }), 'pnpm-lock.yaml': '' });
        expect(summary(await detectChecks(pnpm))).toEqual([
            'node typecheck: pnpm run check-types',
            'node lint: pnpm run lint',
            'node test: pnpm run test',
            'node build: pnpm run build',
        ]);
        const yarn = await project({ 'package.json': pkg({ scripts }), 'yarn.lock': '' });
        expect(summary(await detectChecks(yarn))).toEqual(['node typecheck: yarn check-types', 'node lint: yarn lint', 'node test: yarn test', 'node build: yarn build']);
        const bun = await project({ 'package.json': pkg({ scripts: { test: 'bun test' } }), 'bun.lock': '' });
        expect(summary(await detectChecks(bun))).toEqual(['node test: bun run test']);
    });

    it("ignores npm's placeholder test script", async () => {
        const root = await project({
            'package.json': pkg({ scripts: { test: 'echo "Error: no test specified" && exit 1', lint: 'eslint .' } }),
        });
        expect(summary(await detectChecks(root))).toEqual(['node lint: npm run lint']);
    });

    it('falls back to tsc when there is a tsconfig and typescript but no typecheck script', async () => {
        const files = { 'package.json': pkg({ scripts: { build: 'vite build' }, devDependencies: { typescript: '^5.4.0' } }), 'tsconfig.json': '{}' };
        const npm = await project(files);
        expect(summary(await detectChecks(npm))).toEqual(['node typecheck: npx tsc --noEmit', 'node build: npm run build']);
        const pnpm = await project({ ...files, 'pnpm-lock.yaml': '' });
        expect(byKind(await detectChecks(pnpm), 'typecheck').command).toBe('pnpm exec tsc --noEmit');
        const yarn = await project({ ...files, 'yarn.lock': '' });
        expect(byKind(await detectChecks(yarn), 'typecheck').command).toBe('yarn tsc --noEmit');
        const bun = await project({ ...files, 'bun.lockb': '' });
        expect(byKind(await detectChecks(bun), 'typecheck').command).toBe('bunx tsc --noEmit');

        const noTypescript = await project({ 'package.json': pkg({ scripts: {} }), 'tsconfig.json': '{}' });
        expect(await detectChecks(noTypescript)).toEqual([]);
    });

    it('reports nothing for an unparseable package.json or a missing folder', async () => {
        const broken = await project({ 'package.json': '{ nope' });
        expect(await detectChecks(broken)).toEqual([]);
        expect(await detectChecks(path.join(os.tmpdir(), 'fac-checks-does-not-exist-9f3a'))).toEqual([]);
    });
});

describe('detectChecks: Python', () => {
    it('uses uv with pytest and ruff', async () => {
        const root = await project({
            'pyproject.toml': '[project]\nname = "demo"\n\n[dependency-groups]\ndev = ["pytest>=8", "ruff>=0.5"]\n\n[tool.ruff]\nline-length = 100\n',
            'uv.lock': '',
            'tests/test_app.py': 'def test_ok():\n    assert True\n',
        });
        const checks = await detectChecks(root, 'linux');
        expect(summary(checks)).toEqual(['python lint: uv run ruff check .', 'python test: uv run pytest -x -q']);
    });

    it('falls back to compileall when there is no tooling', async () => {
        const root = await project({ 'requirements.txt': 'requests==2.32.0\n', 'main.py': 'print("hi")\n' });
        const checks = await detectChecks(root, 'linux');
        expect(summary(checks)).toEqual(['python analyze: python -m compileall -q -x "(\\.venv|venv|node_modules|\\.git)" .']);
        expect(checks[0].label).toBe('Static analysis');
        expect(checks[0].cost).toBe('fast');
    });

    it('runs tools through the virtualenv interpreter for the platform', async () => {
        const root = await project({ 'setup.py': 'from setuptools import setup\nsetup()\n', 'pytest.ini': '[pytest]\n', '.venv/': '' });
        expect(byKind(await detectChecks(root, 'linux'), 'test').command).toBe('.venv/bin/python -m pytest -x -q');
        expect(byKind(await detectChecks(root, 'darwin'), 'test').command).toBe('.venv/bin/python -m pytest -x -q');
        expect(byKind(await detectChecks(root, 'win32'), 'test').command).toBe('.venv/Scripts/python -m pytest -x -q');

        const plain = await project({ 'requirements-dev.txt': 'pytest\nflake8\n', '.flake8': '[flake8]\n', 'venv/': '' });
        expect(summary(await detectChecks(plain, 'win32'))).toEqual(['python lint: venv/Scripts/python -m flake8', 'python test: venv/Scripts/python -m pytest -x -q']);
    });

    it('detects poetry, mypy and pyright', async () => {
        const poetry = await project({ 'pyproject.toml': '[tool.poetry]\nname = "x"\n\n[tool.mypy]\nstrict = true\n', 'app.py': '' });
        expect(summary(await detectChecks(poetry))).toEqual(['python typecheck: poetry run mypy .']);

        const withFiles = await project({ 'pyproject.toml': '[tool.mypy]\nfiles = ["src"]\n', 'poetry.lock': '' });
        expect(byKind(await detectChecks(withFiles), 'typecheck').command).toBe('poetry run mypy');

        const pyright = await project({ 'pyproject.toml': '[project]\nname = "x"\n', 'pyrightconfig.json': '{}', 'test_math.py': '' });
        expect(summary(await detectChecks(pyright, 'linux'))).toEqual(['python typecheck: python -m pyright', 'python test: python -m pytest -x -q']);
    });
});

describe('detectChecks: other stacks', () => {
    it('detects Flutter with a test folder and plain Dart without one', async () => {
        const flutter = await project({
            'pubspec.yaml': 'name: app\ndependencies:\n  flutter:\n    sdk: flutter\n',
            'lib/main.dart': '',
            'test/widget_test.dart': '',
        });
        const checks = await detectChecks(flutter);
        expect(summary(checks)).toEqual(['flutter analyze: flutter analyze', 'flutter test: flutter test']);
        expect(checks.map((c) => c.cost)).toEqual(['fast', 'slow']);

        const dart = await project({ 'pubspec.yaml': 'name: cli\ndependencies:\n  args: ^2.0.0\n' });
        expect(summary(await detectChecks(dart))).toEqual(['dart analyze: dart analyze']);
    });

    it('detects Rust', async () => {
        const root = await project({ 'Cargo.toml': '[package]\nname = "x"\n' });
        const checks = await detectChecks(root);
        expect(summary(checks)).toEqual(['rust typecheck: cargo check', 'rust test: cargo test']);
        expect(checks[0].cost).toBe('fast');
    });

    it('detects Go', async () => {
        const root = await project({ 'go.mod': 'module example.com/x\n' });
        expect(summary(await detectChecks(root))).toEqual(['go analyze: go vet ./...', 'go test: go test ./...', 'go build: go build ./...']);
    });

    it('uses the Gradle wrapper for the platform, else gradle', async () => {
        const root = await project({ 'build.gradle.kts': '', gradlew: '#!/bin/sh\n', 'gradlew.bat': '@echo off\r\n' });
        expect(summary(await detectChecks(root, 'linux'))).toEqual(['java build: ./gradlew build -x test', 'java test: ./gradlew test']);
        expect(summary(await detectChecks(root, 'win32'))).toEqual(['java build: ./gradlew.bat build -x test', 'java test: ./gradlew.bat test']);

        const unixOnly = await project({ 'build.gradle': '', gradlew: '' });
        expect(byKind(await detectChecks(unixOnly, 'win32'), 'test').command).toBe('gradle test');
        expect(byKind(await detectChecks(unixOnly, 'darwin'), 'test').command).toBe('./gradlew test');
    });

    it('detects Maven and .NET', async () => {
        const maven = await project({ 'pom.xml': '<project/>' });
        expect(summary(await detectChecks(maven))).toEqual(['java build: mvn -q compile', 'java test: mvn -q test']);

        const dotnet = await project({ 'App.csproj': '<Project/>' });
        expect(summary(await detectChecks(dotnet))).toEqual(['dotnet build: dotnet build', 'dotnet test: dotnet test']);

        const solution = await project({ 'My App.sln': '', 'App.csproj': '' });
        expect(summary(await detectChecks(solution))).toEqual(['dotnet build: dotnet build "My App.sln"', 'dotnet test: dotnet test "My App.sln"']);
    });

    it('returns every stack of a mixed Python + Node root', async () => {
        const root = await project({
            'package.json': pkg({ scripts: { lint: 'eslint web', build: 'vite build' } }),
            'pnpm-lock.yaml': '',
            'requirements.txt': 'fastapi\npytest\n',
            'conftest.py': '',
        });
        expect(summary(await detectChecks(root, 'linux'))).toEqual(['node lint: pnpm run lint', 'node build: pnpm run build', 'python test: python -m pytest -x -q']);
    });
});

describe('commandVerifies', () => {
    async function nodeChecks(): Promise<ProjectCheck[]> {
        const root = await project({
            'package.json': pkg({ scripts: { typecheck: 'tsc --noEmit', lint: 'next lint', test: 'vitest run', build: 'tsc -b' }, devDependencies: { typescript: '5' } }),
            'pnpm-lock.yaml': '',
        });
        return detectChecks(root, 'linux');
    }

    it('recognizes equivalent spellings of a type check', async () => {
        const checks = await nodeChecks();
        for (const command of [
            'tsc',
            'tsc --noEmit',
            'npx tsc --noEmit',
            'pnpm exec tsc',
            'npm run typecheck',
            'yarn typecheck',
            'bun run type-check',
            './node_modules/.bin/tsc --noEmit -p tsconfig.json',
            'cd app && pnpm run typecheck',
            'pnpm --filter web typecheck',
            'npx vue-tsc --noEmit',
        ]) {
            expect(commandVerifies(command, checks)?.kind, command).toBe('typecheck');
        }
    });

    it('recognizes lint, test and build runs', async () => {
        const checks = await nodeChecks();
        const expected: [string, CheckKind][] = [
            ['npm run lint', 'lint'],
            ['npx eslint . --fix', 'lint'],
            ['pnpm next lint', 'lint'],
            ['npm test', 'test'],
            ['npm run test', 'test'],
            ['vitest', 'test'],
            ['npx vitest run src/foo.test.ts', 'test'],
            ['jest --coverage', 'test'],
            ['CI=true npm test', 'test'],
            ['timeout 300 npm test -- --reporter=dot', 'test'],
            ['bash -c "cd web && pnpm test"', 'test'],
            ['cd web; npm run build', 'build'],
            ['pnpm run build 2>&1 | tail -20', 'build'],
        ];
        for (const [command, kind] of expected) {
            expect(commandVerifies(command, checks)?.kind, command).toBe(kind);
        }
    });

    it('recognizes Python test runs', async () => {
        const root = await project({ 'pyproject.toml': '[tool.pytest.ini_options]\n', 'uv.lock': '' });
        const checks = await detectChecks(root, 'linux');
        for (const command of ['pytest', 'python -m pytest', 'python3 -m pytest tests/test_api.py -k login', 'uv run pytest -q', '.venv/bin/pytest', 'poetry run python -m pytest']) {
            expect(commandVerifies(command, checks)?.kind, command).toBe('test');
        }
        expect(commandVerifies('npm test', checks)).toBeUndefined();
    });

    it('matches dart analyze for a Flutter project, and other stacks', async () => {
        const root = await project({
            'pubspec.yaml': 'dependencies:\n  flutter:\n    sdk: flutter\n',
            'test/': '',
            'go.mod': '',
            'Cargo.toml': '',
            'build.gradle': '',
            'gradlew.bat': '',
        });
        const checks = await detectChecks(root, 'win32');
        const expected: [string, string][] = [
            ['dart analyze', 'flutter analyze'],
            ['flutter analyze --no-fatal-infos', 'flutter analyze'],
            ['flutter test test/widget_test.dart', 'flutter test'],
            ['go vet ./...', 'go analyze'],
            ['go test ./pkg/...', 'go test'],
            ['go build -o app .', 'go build'],
            ['cargo clippy --all-targets', 'rust typecheck'],
            ['cargo test --workspace', 'rust test'],
            ['./gradlew.bat test', 'java test'],
            ['gradle :app:build -x test', 'java build'],
        ];
        for (const [command, want] of expected) {
            const found = commandVerifies(command, checks);
            expect(found && `${found.stack} ${found.kind}`, command).toBe(want);
        }
    });

    it('does not match unrelated commands', async () => {
        const checks = [
            ...(await nodeChecks()),
            ...(await detectChecks(await project({ 'pytest.ini': '', 'requirements.txt': 'ruff', 'go.mod': '', 'build.gradle': '' }), 'linux')),
        ];
        for (const command of [
            'npm install',
            'npm i -D vitest',
            'pnpm add jest',
            'git status',
            'cat test.py',
            'echo build',
            'echo npm test',
            'ls node_modules/.bin/tsc',
            'tsc --version',
            'npm run build-storybook',
            'cd go && ls',
            'git commit -m "add tests"',
            "git commit -m 'fix; npm test && tsc'",
            'pip install pytest',
            '',
        ]) {
            expect(commandVerifies(command, checks), command).toBeUndefined();
        }
    });

    it('prefers the most specific match', async () => {
        const checks = await nodeChecks();
        // The build script is `tsc -b`: running it is the build, not merely a type check.
        expect(commandVerifies('npx tsc -b', checks)?.kind).toBe('build');
        expect(commandVerifies('tsc --noEmit', checks)?.kind).toBe('typecheck');
        expect(commandVerifies('rm -rf dist && pnpm run build', checks)?.kind).toBe('build');
    });
});

describe('structureMap', () => {
    it('lists dirs first, sorted, and skips heavy and dot folders', async () => {
        const root = await project({
            'README.md': '',
            'package.json': '{}',
            '.gitignore': '',
            'src/index.ts': '',
            'src/App.tsx': '',
            'src/lib/util.ts': '',
            'Docs/guide.md': '',
            'node_modules/react/index.js': '',
            '.git/HEAD': '',
            '.github/workflows/ci.yml': '',
            'dist/index.js': '',
            '.venv/bin/python': '',
            '__pycache__/a.pyc': '',
            'target/debug/app': '',
            '.freeagentcoder/state.json': '',
        });
        expect(await structureMap(root)).toBe(
            [path.basename(root), '  Docs/', '    guide.md', '  src/', '    lib/', '      util.ts', '    App.tsx', '    index.ts', '  .gitignore', '  package.json', '  README.md'].join('\n'),
        );
    });

    it('collapses big and deep folders with file counts', async () => {
        const files: Record<string, string> = { 'a/b/c/d.txt': '', 'a/b/c/e/f.txt': '', 'a/b/c/node_modules/x.js': '' };
        for (let i = 0; i < 20; i++) {
            files[`assets/img${String(i).padStart(2, '0')}.png`] = '';
        }
        files['assets/icons/one.svg'] = '';
        const root = await project(files);

        expect(await structureMap(root)).toBe([path.basename(root), '  a/', '    b/', '      c/ (2 files)', '  assets/ (21 files)'].join('\n'));
        expect(await structureMap(root, { maxDepth: 1 })).toBe([path.basename(root), '  a/ (2 files)', '  assets/ (21 files)'].join('\n'));
    });

    it('caps file counts for huge folders', async () => {
        const root = await project({ 'data/': '' });
        await Promise.all(Array.from({ length: 1005 }, (_, i) => fs.writeFile(path.join(root, 'data', `row${i}.csv`), '')));
        expect(await structureMap(root)).toBe(`${path.basename(root)}\n  data/ (1000+ files)`);
    });

    it('bounds the folders a count may read and shows a lower bound', async () => {
        const root = await project({});
        await Promise.all(
            Array.from({ length: 160 }, async (_, i) => {
                await fs.mkdir(path.join(root, 'cases', `case${i}`), { recursive: true });
                await fs.writeFile(path.join(root, 'cases', `case${i}`, 'input.json'), '');
            }),
        );
        expect(await structureMap(root)).toBe(`${path.basename(root)}\n  cases/ (150+ files)`);
    });

    it('truncates to maxLines with a count of what was left out', async () => {
        const files: Record<string, string> = {};
        for (let i = 0; i < 30; i++) {
            files[`file${String(i).padStart(2, '0')}.txt`] = '';
        }
        const root = await project(files);
        const lines = (await structureMap(root, { maxLines: 10 })).split('\n');
        expect(lines).toHaveLength(10);
        expect(lines[1]).toBe('  file00.txt');
        expect(lines[8]).toBe('  file07.txt');
        expect(lines[9]).toBe('… (22 more entries)');

        const exact = (await structureMap(root, { maxLines: 31 })).split('\n');
        expect(exact).toHaveLength(31);
        expect(exact[30]).toBe('  file29.txt');
    });
});
