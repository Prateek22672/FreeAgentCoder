import { promises as fs, type Dirent } from 'node:fs';
import * as path from 'node:path';

/**
 * Pure project inspection for verification: which checks (type check, lint,
 * tests, build) a project can run with its own tooling, how to recognize those
 * checks in a command the agent ran, and a compact map of the folder layout.
 * Nothing here runs a command or depends on VS Code.
 */

export type CheckKind = 'typecheck' | 'lint' | 'analyze' | 'test' | 'build';

export interface ProjectCheck {
    kind: CheckKind;
    /** Short human label: "Type check", "Lint", "Static analysis", "Tests", "Build". */
    label: string;
    /** The exact command to run from the project root, using the project's own package manager / environment. */
    command: string;
    /** Recognizes this check (and equivalent spellings of it) inside a shell command line the agent ran. */
    matches: RegExp;
    /** fast: typecheck, lint, analyze. slow: test, build. */
    cost: 'fast' | 'slow';
    /** 'node' | 'python' | 'flutter' | 'dart' | 'rust' | 'go' | 'dotnet' | 'java' */
    stack: string;
}

const LABELS: Record<CheckKind, string> = {
    typecheck: 'Type check',
    lint: 'Lint',
    analyze: 'Static analysis',
    test: 'Tests',
    build: 'Build',
};

function check(stack: string, kind: CheckKind, command: string, matches: RegExp): ProjectCheck {
    const cost = kind === 'test' || kind === 'build' ? 'slow' : 'fast';
    return { kind, label: LABELS[kind], command, matches, cost, stack };
}

// ---------------------------------------------------------------------------
// Recognizing checks inside command lines
// ---------------------------------------------------------------------------

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Where a simple command can begin inside a command line: at the start or after
 * a separator (`&&`, `||`, `;`, `|`, `&`, `(`, `{`, newline), followed by any env
 * assignments (`CI=1`), wrappers (`time`, `env`, `cross-env`, `timeout 300`) and
 * shell hops (`bash -c "`, `cmd /c`). Anchoring here keeps `echo npm test` or
 * `cat test.py` from counting as checks.
 */
const START = String.raw`(?:^|[;&|({\n])\s*(?:(?:[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|[^\s;&|]*)|time|env|cross-env|command|nice|sudo|timeout(?:\s+-[^\s;&|]+)*\s+\d+[smhd]?)\s+|(?:bash|sh|zsh|cmd|powershell|pwsh)(?:\.exe)?(?:\s+[-/]\w+)+\s+["']?)*`;
/** The end of a command word. */
const END = String.raw`(?=$|[\s;&|)}'"\`])`;
const FLAG = String.raw`-[^\s;&|]+`;
/** A flag's value. Never starting with `-` keeps `-p -q` from parsing two ways (and backtracking exponentially). */
const ARG = String.raw`[^\s;&|-][^\s;&|]*`;
/** An optional directory in front of a binary: `./`, `node_modules/.bin/`, `.venv/Scripts/`. */
const BIN_PATH = String.raw`(?:[^\s;&|'"]*[/\\])?`;
/** `--version` / `--help` only print information; they don't verify anything. */
const NO_INFO = String.raw`(?!\s+(?:--version|--help|-h)(?=[\s;&|]|$))`;

/** Builds a check pattern; the named `cmd` group is the command itself, used to rank matches. */
function commandPattern(alternatives: string[]): RegExp {
    return new RegExp(`${START}(?<cmd>${alternatives.map((alt) => `(?:${alt})`).join('|')})`);
}

// Node ----------------------------------------------------------------------

const PM = String.raw`(?:corepack\s+)?${BIN_PATH}(?:npm|pnpm|yarn|bun)(?:\.cmd|\.exe|\.ps1)?`;
/** Package-manager flags, including the ones that take a value (`--prefix app`, `-C app`, `--filter web`). */
const PM_FLAGS = String.raw`(?:\s+(?:(?:--prefix|--dir|--cwd|-C|--filter|-F|--workspace|-w)\s+${ARG}|-(?!-?(?:prefix|dir|cwd|C|filter|F|workspace|w)(?:\s|$))[^\s;&|]+))*`;
/** How a locally installed binary gets invoked: `npx`, `pnpm exec`, `yarn <bin>`, `pnpm <bin>`, `bunx`, `node`, or directly. */
const NODE_EXEC = String.raw`(?:${BIN_PATH}(?:npx|pnpx|bunx)(?:\.cmd|\.exe)?(?:\s+(?:(?:-p|--package)\s+${ARG}|${FLAG}))*\s+|${PM}${PM_FLAGS}\s+(?:exec|dlx|x)(?:\s+${FLAG})*\s+(?:--\s+)?|${BIN_PATH}(?:yarn|pnpm)(?:\.cmd)?${PM_FLAGS}\s+|node(?:\.exe)?\s+)?${BIN_PATH}`;

const TYPECHECK_SCRIPTS = ['typecheck', 'type-check', 'check-types', 'tsc'];
const NODE_TYPECHECK_TOOLS = [String.raw`(?:vue-)?tsc(?!\s+(?:-v|--init)(?=[\s;&|]|$))`];
const NODE_LINT_TOOLS = ['eslint', 'oxlint', 'tslint', String.raw`biome\s+(?:lint|check|ci)`, String.raw`next\s+lint`];
const NODE_TEST_TOOLS = ['vitest', 'jest', 'mocha', 'ava', String.raw`playwright\s+test`, String.raw`cypress\s+run`, String.raw`(?:ng|react-scripts|craco)\s+test`];
const NODE_BUILD_TOOLS = [
    String.raw`(?:vite|next|nuxt|nuxi|astro|ng|react-scripts|craco|remix|svelte-kit|vue-cli-service|parcel)\s+build`,
    'webpack',
    'rollup',
    'tsup',
    'esbuild',
];

/** `npm run lint`, `npm test`, `pnpm --filter web run lint`, `yarn workspace web lint`, `bun run lint:fix`, `turbo run lint`. */
function nodeScriptRun(names: string[]): string {
    const alt = [...new Set(names)].map(escapeRegExp).join('|');
    return String.raw`${PM}${PM_FLAGS}\s+(?:workspace\s+${ARG}\s+)?(?:(?:run|run-script)${PM_FLAGS}\s+)?(?:${alt})(?::[\w.:-]+)?${END}|turbo(?:\.cmd)?(?:\s+run)?(?:\s+${FLAG})*\s+(?:${alt})${END}`;
}

function nodeTools(tools: string[]): string {
    return `${NODE_EXEC}(?:${tools.join('|')})(?:\\.cmd|\\.exe|\\.js)?${NO_INFO}${END}`;
}

/** A single-command script body (`"lint": "next lint"`), recognized when run directly. */
function nodeScriptBody(body: string | undefined): string[] {
    const text = body?.trim();
    if (!text || text.length > 160 || /[;&|<>`]|\$\(/.test(text)) {
        return [];
    }
    return [`${NODE_EXEC}${text.split(/\s+/).map(escapeRegExp).join(String.raw`\s+`)}${END}`];
}

// Python --------------------------------------------------------------------

const PY_RUNNER = String.raw`(?:${BIN_PATH}(?:uv|poetry|pipenv|pdm|hatch|rye)(?:\.exe)?\s+run(?:\s+${FLAG})*\s+|(?:uvx|pipx\s+run)(?:\s+${FLAG})*\s+)?`;
const PY_MODULE = String.raw`${BIN_PATH}(?:python(?:3(?:\.\d+)?)?|py)(?:\.exe)?(?:\s+-[\w.]+)*?\s+-m\s+`;

/** `pytest`, `python -m pytest`, `uv run pytest`, `.venv/bin/pytest`, `poetry run python -m pytest`. */
function pythonTool(tool: string): string {
    return `${PY_RUNNER}(?:${PY_MODULE}|${BIN_PATH})(?:${tool})${NO_INFO}${END}`;
}

const PY_PYTEST = pythonTool(String.raw`(?:pytest|py\.test)(?:\.exe)?`);
const PY_RUFF = pythonTool(String.raw`ruff(?:\.exe)?(?:\s+${FLAG})*\s+check`);
const PY_FLAKE8 = pythonTool(String.raw`flake8(?:\.exe)?`);
const PY_MYPY = pythonTool(String.raw`mypy(?:\.exe)?`);
const PY_PYRIGHT = `${pythonTool(String.raw`(?:based)?pyright(?:\.exe)?`)}|${NODE_EXEC}(?:based)?pyright${NO_INFO}${END}`;
const PY_COMPILE = String.raw`${PY_RUNNER}${PY_MODULE}(?:compileall|py_compile)${END}`;

// Other stacks --------------------------------------------------------------

const DART_SDK = String.raw`(?:fvm(?:\.bat|\.exe)?\s+)?${BIN_PATH}(?:flutter|dart)(?:\.bat|\.exe)?(?:\s+${FLAG})*`;
const CARGO = String.raw`${BIN_PATH}cargo(?:\.exe)?(?:\s+\+[^\s;&|]+)?(?:\s+${FLAG})*`;
const GO = String.raw`${BIN_PATH}go(?:\.exe)?`;
const DOTNET = String.raw`${BIN_PATH}dotnet(?:\.exe)?`;
const MAVEN = String.raw`${BIN_PATH}mvnw?(?:\.cmd)?(?:\s+(?:(?:-pl|-f|--file|-P|-rf|--projects)\s+${ARG}|${FLAG}|clean|validate|[\w.][\w.-]*:[\w.:-]+))*`;
const GRADLE = String.raw`${BIN_PATH}(?:gradlew|gradle)(?:\.bat)?(?:\s+(?:(?:-x|--exclude-task|-p|--project-dir)\s+${ARG}|-(?!(?:x|-exclude-task)(?:\s|$))[^\s;&|]+|clean))*`;

/**
 * Blanks quoted arguments (`git commit -m "fix; npm test"`) so text inside them
 * isn't read as commands, except the script handed to a shell (`bash -c "..."`,
 * `cmd /c "..."`, `powershell -Command "..."`), which really runs.
 */
function maskQuotedArguments(command: string): string {
    return command.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, (quoted: string, offset: number) =>
        /(?:^|\s)(?:-\w*c|\/[ckCK]|-[Cc]ommand)\s*$/.test(command.slice(0, offset)) ? quoted : '""',
    );
}

/** The check a command line performs, if any (e.g. "cd app && pnpm run typecheck" -> the typecheck check). */
export function commandVerifies(command: string, checks: ProjectCheck[]): ProjectCheck | undefined {
    const line = maskQuotedArguments(command);
    let best: ProjectCheck | undefined;
    let bestScore = 0;
    for (const candidate of checks) {
        const flags = candidate.matches.flags.replace(/[gy]/g, '');
        const pattern = new RegExp(candidate.matches.source, `${flags}g`);
        for (const match of line.matchAll(pattern)) {
            // The longest recognized command is the most specific one: `npx tsc -b`
            // as a build script beats the bare `tsc` of a type check.
            const score = (match.groups?.cmd ?? match[0]).trim().length;
            if (score > bestScore) {
                best = candidate;
                bestScore = score;
            }
        }
    }
    return best;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

interface ProjectRoot {
    dir: string;
    platform: NodeJS.Platform;
    files: Set<string>;
    dirs: Set<string>;
    read(file: string): Promise<string>;
}

async function scanRoot(dir: string, platform: NodeJS.Platform): Promise<ProjectRoot | undefined> {
    let entries: Dirent[];
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return undefined;
    }
    const files = new Set<string>();
    const dirs = new Set<string>();
    await Promise.all(
        entries.map(async (entry) => {
            let isDir = entry.isDirectory();
            if (entry.isSymbolicLink()) {
                isDir = await fs.stat(path.join(dir, entry.name)).then((stat) => stat.isDirectory(), () => false);
            }
            (isDir ? dirs : files).add(entry.name);
        }),
    );
    const read = async (file: string): Promise<string> => (files.has(file) ? fs.readFile(path.join(dir, file), 'utf8').catch(() => '') : '');
    return { dir, platform, files, dirs, read };
}

/** Checks the project at `root` can actually run, most useful first within each stack. */
export async function detectChecks(root: string, platform: NodeJS.Platform = process.platform): Promise<ProjectCheck[]> {
    const project = await scanRoot(root, platform);
    if (!project) {
        return [];
    }
    const groups = await Promise.all([
        nodeChecks(project),
        pythonChecks(project),
        dartChecks(project),
        rustChecks(project),
        goChecks(project),
        dotnetChecks(project),
        javaChecks(project),
    ]);
    return groups.flat();
}

// Node ----------------------------------------------------------------------

interface PackageJson {
    scripts?: unknown;
    dependencies?: unknown;
    devDependencies?: unknown;
    packageManager?: unknown;
}

function stringRecord(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object') {
        return {};
    }
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

type NodeManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

function nodeManager(project: ProjectRoot, pkg: PackageJson): NodeManager {
    if (project.files.has('pnpm-lock.yaml')) {
        return 'pnpm';
    }
    if (project.files.has('yarn.lock')) {
        return 'yarn';
    }
    if (project.files.has('bun.lockb') || project.files.has('bun.lock')) {
        return 'bun';
    }
    if (project.files.has('package-lock.json') || typeof pkg.packageManager !== 'string') {
        return 'npm';
    }
    // No lockfile yet: Corepack's "packageManager": "pnpm@9.1.0" still names the manager.
    const named = /^(pnpm|yarn|bun)@/.exec(pkg.packageManager);
    return named ? (named[1] as NodeManager) : 'npm';
}

/** npm's `npm init` placeholder, which always fails. */
function isPlaceholderTest(script: string): boolean {
    return /no test specified/i.test(script) && /exit 1/.test(script);
}

/**
 * Node checks come from the root package.json only. In a monorepo the root
 * scripts usually fan out to the workspaces (turbo, nx, `pnpm -r`); a workspace
 * that only has its own scripts is not detected here.
 */
async function nodeChecks(project: ProjectRoot): Promise<ProjectCheck[]> {
    if (!project.files.has('package.json')) {
        return [];
    }
    let pkg: PackageJson;
    try {
        const parsed: unknown = JSON.parse(await project.read('package.json'));
        if (!parsed || typeof parsed !== 'object') {
            return [];
        }
        pkg = parsed as PackageJson;
    } catch {
        return [];
    }
    const scripts = stringRecord(pkg.scripts);
    const deps = { ...stringRecord(pkg.dependencies), ...stringRecord(pkg.devDependencies) };
    const manager = nodeManager(project, pkg);
    const has = (name: string) => (scripts[name] ?? '').trim() !== '';
    const run = (name: string): string => {
        switch (manager) {
            case 'npm':
                return name === 'test' ? 'npm test' : `npm run ${name}`;
            case 'yarn':
                return `yarn ${name}`;
            default:
                return `${manager} run ${name}`;
        }
    };
    const checks: ProjectCheck[] = [];

    const typecheckScript = TYPECHECK_SCRIPTS.find(has);
    const exec = { npm: 'npx', pnpm: 'pnpm exec', yarn: 'yarn', bun: 'bunx' }[manager];
    const typecheckCommand = typecheckScript
        ? run(typecheckScript)
        : project.files.has('tsconfig.json') && 'typescript' in deps
          ? `${exec} tsc --noEmit`
          : undefined;
    if (typecheckCommand) {
        const alternatives = [nodeScriptRun(TYPECHECK_SCRIPTS), nodeTools(NODE_TYPECHECK_TOOLS)];
        // The literal script body goes first so a match reports its longest spelling (see commandVerifies).
        checks.push(check('node', 'typecheck', typecheckCommand, commandPattern([...nodeScriptBody(typecheckScript && scripts[typecheckScript]), ...alternatives])));
    }
    if (has('lint')) {
        checks.push(check('node', 'lint', run('lint'), commandPattern([...nodeScriptBody(scripts.lint), nodeScriptRun(['lint']), nodeTools(NODE_LINT_TOOLS)])));
    }
    if (has('test') && !isPlaceholderTest(scripts.test)) {
        const nodeTest = String.raw`node(?:\.exe)?(?:\s+${FLAG})*?\s+--test${END}`;
        checks.push(check('node', 'test', run('test'), commandPattern([...nodeScriptBody(scripts.test), nodeScriptRun(['test']), nodeTools(NODE_TEST_TOOLS), nodeTest])));
    }
    if (has('build')) {
        checks.push(check('node', 'build', run('build'), commandPattern([...nodeScriptBody(scripts.build), nodeScriptRun(['build']), nodeTools(NODE_BUILD_TOOLS)])));
    }
    return checks;
}

// Python --------------------------------------------------------------------

/** `name` listed as a dependency in requirements, pyproject, setup.py/cfg or a Pipfile. */
function listsDependency(text: string, name: string): boolean {
    return new RegExp(String.raw`(?:^|[\s"'\[,])${escapeRegExp(name)}(?=[\s=<>~!\[;"',]|$)`, 'im').test(text);
}

/** The body of an INI/TOML section whose header matches, up to the next header. */
function section(text: string, header: RegExp): string {
    const body: string[] = [];
    let inside = false;
    for (const line of text.split(/\r?\n/)) {
        if (/^\s*\[/.test(line)) {
            inside = header.test(line.trim());
        } else if (inside) {
            body.push(line);
        }
    }
    return body.join('\n');
}

interface PythonRunner {
    /** Command prefix that runs an installed tool, e.g. `uv run ` or `python -m `. */
    tool: string;
    /** The interpreter, e.g. `uv run python` or `.venv/bin/python`. */
    python: string;
}

function pythonRunner(project: ProjectRoot, pyproject: string): PythonRunner {
    if (project.files.has('uv.lock')) {
        return { tool: 'uv run ', python: 'uv run python' };
    }
    if (project.files.has('poetry.lock') || /^\[tool\.poetry\]/m.test(pyproject)) {
        return { tool: 'poetry run ', python: 'poetry run python' };
    }
    const venv = ['.venv', 'venv'].find((dir) => project.dirs.has(dir));
    // Forward slashes on Windows too: the agent's shell there is Git Bash or
    // PowerShell, and both accept `.venv/Scripts/python`, while Git Bash would
    // eat the backslashes of `.venv\Scripts\python`.
    const python = venv ? `${venv}/${project.platform === 'win32' ? 'Scripts' : 'bin'}/python` : 'python';
    return { tool: `${python} -m `, python };
}

async function pythonChecks(project: ProjectRoot): Promise<ProjectCheck[]> {
    const requirements = [...project.files].filter((file) => /^requirements.*\.txt$/i.test(file)).sort();
    const markers = ['pyproject.toml', 'setup.py', 'setup.cfg', 'Pipfile'];
    if (!requirements.length && !markers.some((file) => project.files.has(file))) {
        return [];
    }
    const [pyproject, setupCfg, toxIni, setupPy, pipfile, mypyIni, ...requirementTexts] = await Promise.all(
        ['pyproject.toml', 'setup.cfg', 'tox.ini', 'setup.py', 'Pipfile', project.files.has('mypy.ini') ? 'mypy.ini' : '.mypy.ini', ...requirements].map((file) =>
            project.read(file),
        ),
    );
    const dependencies = [pyproject, setupPy, setupCfg, pipfile, ...requirementTexts].join('\n');
    const runner = pythonRunner(project, pyproject);
    const checks: ProjectCheck[] = [];

    const mypy = /^\[tool\.mypy\]/m.test(pyproject) || project.files.has('mypy.ini') || project.files.has('.mypy.ini') || /^\[mypy\]/m.test(setupCfg);
    const pyright = project.files.has('pyrightconfig.json') || /^\[tool\.pyright\]/m.test(pyproject);
    if (mypy || pyright) {
        let command = `${runner.tool}pyright`;
        if (mypy) {
            // With `files = ...` configured, mypy knows what to check; a `.` target would override it.
            const config = [section(pyproject, /^\[tool\.mypy\]$/), section(mypyIni, /^\[mypy\]$/), section(setupCfg, /^\[mypy\]$/)].join('\n');
            command = `${runner.tool}mypy${/^\s*files\s*=/m.test(config) ? '' : ' .'}`;
        }
        checks.push(check('python', 'typecheck', command, commandPattern([...(mypy ? [PY_MYPY] : []), ...(pyright ? [PY_PYRIGHT] : [])])));
    }

    const ruff = /^\[tool\.ruff/m.test(pyproject) || project.files.has('ruff.toml') || project.files.has('.ruff.toml') || listsDependency(dependencies, 'ruff');
    const flake8 = project.files.has('.flake8') || /^\[flake8\]/m.test(setupCfg) || /^\[flake8\]/m.test(toxIni);
    if (ruff || flake8) {
        const command = ruff ? `${runner.tool}ruff check .` : `${runner.tool}flake8`;
        checks.push(check('python', 'lint', command, commandPattern([...(ruff ? [PY_RUFF] : []), ...(flake8 ? [PY_FLAKE8] : [])])));
    }

    if (await hasPytest(project, pyproject, setupCfg, toxIni, dependencies)) {
        checks.push(check('python', 'test', `${runner.tool}pytest -x -q`, commandPattern([PY_PYTEST])));
    }

    if (!checks.length) {
        // No configured tooling: byte-compiling every file still catches syntax errors.
        const command = `${runner.python} -m compileall -q -x "(\\.venv|venv|node_modules|\\.git)" .`;
        checks.push(check('python', 'analyze', command, commandPattern([PY_COMPILE])));
    }
    return checks;
}

async function hasPytest(project: ProjectRoot, pyproject: string, setupCfg: string, toxIni: string, dependencies: string): Promise<boolean> {
    if (
        project.files.has('pytest.ini') ||
        project.files.has('conftest.py') ||
        /^\[tool\.pytest/m.test(pyproject) ||
        /^\[tool:pytest\]/m.test(setupCfg) ||
        /^\[pytest\]/m.test(toxIni) ||
        listsDependency(dependencies, 'pytest') ||
        project.dirs.has('tests')
    ) {
        return true;
    }
    const isTestFile = (name: string) => /^test_.*\.py$|_test\.py$/.test(name);
    if ([...project.files].some(isTestFile)) {
        return true;
    }
    if (project.dirs.has('test')) {
        const names = await fs.readdir(path.join(project.dir, 'test')).catch(() => [] as string[]);
        return names.some(isTestFile);
    }
    return false;
}

// Flutter / Dart ------------------------------------------------------------

async function dartChecks(project: ProjectRoot): Promise<ProjectCheck[]> {
    if (!project.files.has('pubspec.yaml')) {
        return [];
    }
    const pubspec = await project.read('pubspec.yaml');
    const tool = /^\s*sdk:\s*["']?flutter["']?\s*(?:#.*)?$/m.test(pubspec) ? 'flutter' : 'dart';
    const checks = [check(tool, 'analyze', `${tool} analyze`, commandPattern([String.raw`${DART_SDK}\s+analyze${NO_INFO}${END}`]))];
    if (project.dirs.has('test')) {
        checks.push(check(tool, 'test', `${tool} test`, commandPattern([String.raw`${DART_SDK}\s+test${NO_INFO}${END}`])));
    }
    return checks;
}

// Rust, Go, .NET, Java ------------------------------------------------------

async function rustChecks(project: ProjectRoot): Promise<ProjectCheck[]> {
    if (!project.files.has('Cargo.toml')) {
        return [];
    }
    return [
        check('rust', 'typecheck', 'cargo check', commandPattern([String.raw`${CARGO}\s+(?:check|clippy|build)${NO_INFO}${END}`])),
        check('rust', 'test', 'cargo test', commandPattern([String.raw`${CARGO}\s+(?:test|nextest\s+run)${NO_INFO}${END}`])),
    ];
}

async function goChecks(project: ProjectRoot): Promise<ProjectCheck[]> {
    if (!project.files.has('go.mod')) {
        return [];
    }
    return [
        check('go', 'analyze', 'go vet ./...', commandPattern([String.raw`${GO}\s+vet${END}`, String.raw`${BIN_PATH}staticcheck(?:\.exe)?${END}`, String.raw`${BIN_PATH}golangci-lint(?:\.exe)?\s+run${END}`])),
        check('go', 'test', 'go test ./...', commandPattern([String.raw`${GO}\s+test${END}`])),
        check('go', 'build', 'go build ./...', commandPattern([String.raw`${GO}\s+build${END}`])),
    ];
}

async function dotnetChecks(project: ProjectRoot): Promise<ProjectCheck[]> {
    const names = [...project.files].sort();
    const solutions = names.filter((file) => /\.slnx?$/i.test(file));
    const projects = names.filter((file) => /\.(?:cs|fs|vb)proj$/i.test(file));
    if (!solutions.length && !projects.length) {
        return [];
    }
    // `dotnet build` refuses to guess when the root holds more than one solution/project file.
    const target = solutions.length + projects.length > 1 ? (solutions[0] ?? projects[0]) : undefined;
    const suffix = target ? ` ${/\s/.test(target) ? `"${target}"` : target}` : '';
    return [
        check('dotnet', 'build', `dotnet build${suffix}`, commandPattern([String.raw`${DOTNET}\s+build${END}`, String.raw`${BIN_PATH}msbuild(?:\.exe)?${END}`])),
        check('dotnet', 'test', `dotnet test${suffix}`, commandPattern([String.raw`${DOTNET}\s+test${END}`])),
    ];
}

async function javaChecks(project: ProjectRoot): Promise<ProjectCheck[]> {
    const win = project.platform === 'win32';
    const checks: ProjectCheck[] = [];
    if (project.files.has('pom.xml')) {
        // Like Gradle, prefer the project's Maven wrapper when it has one.
        const wrapper = win ? 'mvnw.cmd' : 'mvnw';
        const mvn = project.files.has(wrapper) ? `./${wrapper}` : 'mvn';
        checks.push(
            check('java', 'build', `${mvn} -q compile`, commandPattern([String.raw`${MAVEN}\s+(?:compile|test-compile|package|verify|install)${END}`])),
            check('java', 'test', `${mvn} -q test`, commandPattern([String.raw`${MAVEN}\s+test${END}`])),
        );
    }
    if (['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'].some((file) => project.files.has(file))) {
        // `./gradlew.bat` rather than `gradlew.bat`: neither Git Bash nor PowerShell runs a bare name from the current folder.
        const wrapper = win ? 'gradlew.bat' : 'gradlew';
        const gradle = project.files.has(wrapper) ? `./${wrapper}` : 'gradle';
        checks.push(
            check('java', 'build', `${gradle} build -x test`, commandPattern([String.raw`${GRADLE}\s+(?:[\w-]*:)*(?:build|assemble\w*|compile\w*|classes)${END}`])),
            check('java', 'test', `${gradle} test`, commandPattern([String.raw`${GRADLE}\s+(?:[\w-]*:)*test\w*${END}`])),
        );
    }
    return checks;
}

// ---------------------------------------------------------------------------
// Structure map
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
    'node_modules',
    'dist',
    'build',
    'out',
    'coverage',
    'venv',
    'env',
    '__pycache__',
    'target',
    'bin',
    'obj',
    'Pods',
    'DerivedData',
]);
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db']);
/** A directory with more entries than this is shown as a file count instead of listed. */
const MAX_CHILDREN = 15;
/** File counts stop at this many and show as "1000+ files". */
const COUNT_CAP = 1000;
/** Subfolders one count may read; past it the count shows as a lower bound ("240+ files"). */
const COUNT_DIRS_PER_FOLDER = 150;
/** Subfolders all counts in one map may read together, so huge trees stay fast. */
const COUNT_DIRS_TOTAL = 600;
/** Folders read in parallel while counting. */
const COUNT_BATCH = 16;

interface Listing {
    dirs: string[];
    files: string[];
}

/** Dot-folders (.git, .next, .venv, .idea, .vscode, .freeagentcoder, ...) and generated/heavy folders. */
function skipDir(name: string): boolean {
    return name.startsWith('.') || SKIP_DIRS.has(name) || name.endsWith('.egg-info');
}

function byName(a: string, b: string): number {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    if (x !== y) {
        return x < y ? -1 : 1;
    }
    return a < b ? -1 : a > b ? 1 : 0;
}

/** Symlinks are listed as plain entries and never followed. */
async function listDir(dir: string, sort = true): Promise<Listing | undefined> {
    let entries: Dirent[];
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return undefined;
    }
    const dirs: string[] = [];
    const files: string[] = [];
    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (!skipDir(entry.name)) {
                dirs.push(entry.name);
            }
        } else if (!SKIP_FILES.has(entry.name)) {
            files.push(entry.name);
        }
    }
    if (sort) {
        dirs.sort(byName);
        files.sort(byName);
    }
    return { dirs, files };
}

/**
 * Files beneath `dir` (skipped folders excluded), breadth-first. The folder
 * itself is always read; its subfolders draw on the per-folder and shared budgets.
 */
async function countFiles(dir: string, budget: { dirs: number }, first?: Listing): Promise<string> {
    const top = first ?? (await listDir(dir, false));
    if (!top) {
        return '0 files';
    }
    let count = top.files.length;
    const queue = top.dirs.map((name) => path.join(dir, name));
    let next = 0;
    while (next < queue.length && count <= COUNT_CAP) {
        const room = Math.min(COUNT_BATCH, COUNT_DIRS_PER_FOLDER - next, budget.dirs, queue.length - next);
        if (room <= 0) {
            break;
        }
        const batch = queue.slice(next, next + room);
        next += room;
        budget.dirs -= room;
        const listings = await Promise.all(batch.map((folder) => listDir(folder, false)));
        listings.forEach((listing, i) => {
            if (listing) {
                count += listing.files.length;
                for (const name of listing.dirs) {
                    queue.push(path.join(batch[i], name));
                }
            }
        });
    }
    if (count > COUNT_CAP) {
        return `${COUNT_CAP}+ files`;
    }
    if (next < queue.length) {
        return `${count}+ files`;
    }
    return count === 1 ? '1 file' : `${count} files`;
}

/** A compact tree of the project for an AI agent: dirs first, sorted, heavy/generated folders skipped. */
export async function structureMap(root: string, opts: { maxDepth?: number; maxLines?: number } = {}): Promise<string> {
    const maxDepth = Math.max(1, Math.floor(opts.maxDepth ?? 3));
    const maxLines = Math.max(2, Math.floor(opts.maxLines ?? 120));
    const resolved = path.resolve(root);
    const lines = [path.basename(resolved) || resolved];
    const budget = { dirs: COUNT_DIRS_TOTAL };
    let hidden = 0;

    // Depth-first; once the line limit is reached nothing more is read, and the
    // entries already listed but not shown are counted for the final line.
    const walk = async (dir: string, listing: Listing, depth: number): Promise<void> => {
        const entries = [...listing.dirs.map((name) => ({ name, isDir: true })), ...listing.files.map((name) => ({ name, isDir: false }))];
        const indent = '  '.repeat(depth);
        for (let i = 0; i < entries.length; i++) {
            if (lines.length >= maxLines) {
                hidden += entries.length - i;
                return;
            }
            const { name, isDir } = entries[i];
            if (!isDir) {
                lines.push(`${indent}${name}`);
                continue;
            }
            const full = path.join(dir, name);
            if (depth >= maxDepth) {
                lines.push(`${indent}${name}/ (${await countFiles(full, budget)})`);
                continue;
            }
            const children = await listDir(full);
            if (!children) {
                lines.push(`${indent}${name}/`);
            } else if (children.dirs.length + children.files.length > MAX_CHILDREN) {
                lines.push(`${indent}${name}/ (${await countFiles(full, budget, children)})`);
            } else {
                lines.push(`${indent}${name}/`);
                await walk(full, children, depth + 1);
            }
        }
    };

    const top = await listDir(resolved);
    if (top) {
        await walk(resolved, top, 1);
    }
    if (hidden > 0) {
        hidden += lines.length - (maxLines - 1);
        lines.length = maxLines - 1;
        lines.push(`… (${hidden} more entries)`);
    }
    return lines.join('\n');
}
