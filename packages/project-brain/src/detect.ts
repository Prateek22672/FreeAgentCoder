/**
 * Stack detection: language, framework, package manager, database, testing.
 *
 * Every detector returns evidence, and nothing is reported without a file
 * behind it. When a signal is only suggestive the finding says `inferred`.
 */
import { extensionOf } from './ingest';
import type { DependencyInfo, Finding, LanguageStat, RepoFile, RepoInput } from './types';

const LANGUAGE_BY_EXT: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
    js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
    py: 'Python', pyi: 'Python',
    java: 'Java', kt: 'Kotlin', kts: 'Kotlin', scala: 'Scala', groovy: 'Groovy',
    go: 'Go', rs: 'Rust', rb: 'Ruby', php: 'PHP', cs: 'C#', fs: 'F#', vb: 'Visual Basic',
    c: 'C', h: 'C', cpp: 'C++', cc: 'C++', cxx: 'C++', hpp: 'C++', hh: 'C++',
    swift: 'Swift', m: 'Objective-C', mm: 'Objective-C++', dart: 'Dart',
    vue: 'Vue', svelte: 'Svelte', astro: 'Astro', ex: 'Elixir', exs: 'Elixir',
    erl: 'Erlang', hs: 'Haskell', lua: 'Lua', r: 'R', jl: 'Julia', zig: 'Zig',
    sql: 'SQL', sh: 'Shell', bash: 'Shell', ps1: 'PowerShell',
    css: 'CSS', scss: 'SCSS', sass: 'Sass', less: 'Less',
    html: 'HTML', md: 'Markdown', mdx: 'MDX',
    json: 'JSON', yml: 'YAML', yaml: 'YAML', toml: 'TOML', xml: 'XML',
};

/** Languages that are content or configuration, not the code that defines the project. */
const SUPPORTING = new Set(['Markdown', 'MDX', 'JSON', 'YAML', 'TOML', 'XML', 'CSS', 'SCSS', 'Sass', 'Less', 'HTML', 'Shell', 'PowerShell']);

export function detectLanguages(input: RepoInput): LanguageStat[] {
    const sizes = new Map(input.files.map((f) => [f.path, f.bytes]));
    const stats = new Map<string, { files: number; bytes: number }>();
    for (const path of input.paths) {
        const name = LANGUAGE_BY_EXT[extensionOf(path)];
        if (!name) continue;
        const entry = stats.get(name) ?? { files: 0, bytes: 0 };
        entry.files++;
        entry.bytes += sizes.get(path) ?? 0;
        stats.set(name, entry);
    }
    // Share is over real code, so a wall of Markdown can't claim the project.
    const codeBytes = [...stats].filter(([name]) => !SUPPORTING.has(name)).reduce((n, [, s]) => n + s.bytes, 0) || 1;
    return [...stats]
        .map(([name, s]) => ({ name, files: s.files, bytes: s.bytes, share: SUPPORTING.has(name) ? 0 : s.bytes / codeBytes }))
        .sort((a, b) => b.share - a.share || b.files - a.files);
}

const LOCKFILES: [file: string, manager: string][] = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['bun.lockb', 'bun'],
    ['bun.lock', 'bun'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
    ['poetry.lock', 'poetry'],
    ['uv.lock', 'uv'],
    ['Pipfile.lock', 'pipenv'],
    ['Cargo.lock', 'cargo'],
    ['go.sum', 'go modules'],
    ['Gemfile.lock', 'bundler'],
    ['composer.lock', 'composer'],
    ['pubspec.lock', 'pub'],
];

const MANIFESTS: [file: string, manager: string][] = [
    ['requirements.txt', 'pip'],
    ['pyproject.toml', 'pip'],
    ['Cargo.toml', 'cargo'],
    ['go.mod', 'go modules'],
    ['pom.xml', 'maven'],
    ['build.gradle', 'gradle'],
    ['build.gradle.kts', 'gradle'],
    ['pubspec.yaml', 'pub'],
    ['Gemfile', 'bundler'],
    ['composer.json', 'composer'],
    ['package.json', 'npm'],
];

export function detectPackageManager(input: RepoInput): Finding | undefined {
    const rootFiles = new Set(input.paths.filter((p) => !p.includes('/')));
    for (const [file, manager] of LOCKFILES) {
        if (rootFiles.has(file)) return { value: manager, confidence: 'detected', evidence: [file] };
    }
    for (const [file, manager] of MANIFESTS) {
        if (rootFiles.has(file)) {
            return { value: manager, confidence: 'inferred', evidence: [file], note: 'No lock file, so this is the manifest’s default manager.' };
        }
    }
    return undefined;
}

export interface PackageJson {
    name?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
    packageManager?: string;
    workspaces?: string[] | { packages?: string[] };
}

export function readPackageJson(input: RepoInput): { json: PackageJson; path: string } | undefined {
    const file = input.files.find((f) => f.path === 'package.json');
    if (!file) return undefined;
    try {
        return { json: JSON.parse(file.text) as PackageJson, path: file.path };
    } catch {
        return undefined;
    }
}

/** Manifests deeper than this are examples or fixtures, not the project. */
const MANIFEST_DEPTH = 3;

/** pip names compare case-insensitively with -, _ and . equivalent, and extras dropped. */
export function normalizePackage(name: string): string {
    return name.replace(/\[.*$/, '').trim().toLowerCase().replace(/[_.]+/g, '-');
}

/** The name at the start of a PEP 508 requirement: "fastapi[standard]>=0.1" -> "fastapi". */
function requirementName(spec: string): { name: string; version: string } | undefined {
    const match = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*(.*)$/.exec(spec);
    if (!match?.[1]) return undefined;
    return { name: match[1], version: (match[3] ?? '').split(';')[0]?.trim() || '*' };
}

function tomlSection(text: string, header: string): string {
    const start = text.indexOf(`[${header}]`);
    if (start === -1) return '';
    const rest = text.slice(start + header.length + 2);
    const next = rest.search(/\n\[[^\]]+\]/);
    return next === -1 ? rest : rest.slice(0, next);
}

/**
 * The quoted strings of a TOML array starting at `from` (just after its "[").
 * Scanned rather than matched, because values contain brackets of their own:
 * "fastapi[standard]>=0.1" must not end the array.
 */
function scanArray(text: string, from: number): string[] {
    const values: string[] = [];
    let quote: string | undefined;
    let current = '';
    for (let i = from; i < text.length; i++) {
        const ch = text[i]!;
        if (quote) {
            if (ch === quote) {
                values.push(current);
                current = '';
                quote = undefined;
            } else current += ch;
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '#') while (i < text.length && text[i] !== '\n') i++;
        else if (ch === ']') break;
    }
    return values;
}

/** Quoted strings inside `key = [ ... ]`, which may span lines. */
function tomlArray(section: string, key: string): string[] {
    const match = new RegExp(`(?:^|\\n)\\s*${key.replace(/[-.]/g, '\\$&')}\\s*=\\s*\\[`).exec(section);
    return match ? scanArray(section, match.index + match[0].length) : [];
}

/** Every `name = [ ... ]` array in a section, e.g. the groups of [dependency-groups]. */
function tomlArrays(section: string): string[] {
    const values: string[] = [];
    for (const match of section.matchAll(/(?:^|\n)\s*[\w.-]+\s*=\s*\[/g)) values.push(...scanArray(section, (match.index ?? 0) + match[0].length));
    return values;
}

function fromPyproject(text: string, source: string): DependencyInfo[] {
    const deps: DependencyInfo[] = [];
    const add = (spec: string, kind: DependencyInfo['kind']) => {
        const parsed = requirementName(spec);
        if (parsed) deps.push({ ...parsed, kind, ecosystem: 'pip', source });
    };
    for (const spec of tomlArray(tomlSection(text, 'project'), 'dependencies')) add(spec, 'prod');
    for (const group of ['dependency-groups', 'project.optional-dependencies']) {
        for (const spec of tomlArrays(tomlSection(text, group))) add(spec, 'dev');
    }
    for (const spec of tomlArray(tomlSection(text, 'tool.uv'), 'dev-dependencies')) add(spec, 'dev');
    // Poetry: `name = "^1.0"` lines.
    for (const [header, kind] of [
        ['tool.poetry.dependencies', 'prod'],
        ['tool.poetry.group.dev.dependencies', 'dev'],
        ['tool.poetry.dev-dependencies', 'dev'],
    ] as const) {
        for (const line of tomlSection(text, header).split('\n')) {
            const match = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=\s*(.*)$/.exec(line);
            if (match?.[1] && match[1].toLowerCase() !== 'python') deps.push({ name: match[1], version: (match[2] ?? '').replace(/["']/g, '').trim() || '*', kind, ecosystem: 'pip', source });
        }
    }
    return deps;
}

export function collectDependencies(input: RepoInput): DependencyInfo[] {
    const deps: DependencyInfo[] = [];
    const manifests = input.files.filter((f) => f.path.split('/').length <= MANIFEST_DEPTH && !/(^|\/)(examples?|fixtures?|test|tests|__tests__)\//.test(f.path));

    for (const file of manifests) {
        const name = file.path.slice(file.path.lastIndexOf('/') + 1);
        if (name === 'package.json') {
            try {
                const json = JSON.parse(file.text) as PackageJson;
                for (const [dep, version] of Object.entries(json.dependencies ?? {})) deps.push({ name: dep, version, kind: 'prod', ecosystem: 'npm', source: file.path });
                for (const [dep, version] of Object.entries(json.devDependencies ?? {})) deps.push({ name: dep, version, kind: 'dev', ecosystem: 'npm', source: file.path });
            } catch {
                // A broken manifest is reported as nothing rather than guessed at.
            }
        } else if (/^requirements.*\.txt$/.test(name)) {
            const kind = /dev|test/.test(name) ? 'dev' : 'prod';
            for (const line of file.text.split('\n')) {
                const spec = (line.split('#')[0] ?? '').trim();
                if (!spec || spec.startsWith('-')) continue;
                const parsed = requirementName(spec);
                if (parsed) deps.push({ ...parsed, kind, ecosystem: 'pip', source: file.path });
            }
        } else if (name === 'pyproject.toml') {
            deps.push(...fromPyproject(file.text, file.path));
        } else if (name === 'Cargo.toml') {
            for (const [header, kind] of [
                ['dependencies', 'prod'],
                ['dev-dependencies', 'dev'],
            ] as const) {
                for (const line of tomlSection(file.text, header).split('\n')) {
                    const match = /^\s*([A-Za-z0-9_-]+)\s*=/.exec(line);
                    if (match?.[1]) deps.push({ name: match[1], version: '*', kind, ecosystem: 'cargo', source: file.path });
                }
            }
        } else if (name === 'go.mod') {
            const block = /require\s*\(([\s\S]*?)\)/.exec(file.text)?.[1] ?? '';
            const single = [...file.text.matchAll(/^require\s+(\S+)\s+(\S+)/gm)].map((m) => `${m[1]} ${m[2]}`);
            for (const line of [...block.split('\n'), ...single]) {
                const match = /^\s*([\w.-]+\/[\w./-]+)\s+(v[\w.+-]+)/.exec(line);
                if (match?.[1]) deps.push({ name: match[1], version: match[2] ?? '*', kind: line.includes('// indirect') ? 'dev' : 'prod', ecosystem: 'go', source: file.path });
            }
        }
    }

    // The same package from two manifests is one dependency; keep the runtime one.
    const seen = new Map<string, DependencyInfo>();
    for (const dep of deps) {
        const key = `${dep.ecosystem}:${normalizePackage(dep.name)}`;
        const existing = seen.get(key);
        if (!existing || (existing.kind === 'dev' && dep.kind === 'prod')) seen.set(key, dep);
    }
    return [...seen.values()];
}

interface Signal {
    value: string;
    /** npm/pip package names that prove it. */
    packages?: string[];
    /** Files whose presence proves it. */
    files?: string[];
    /** Folders that suggest it. */
    dirs?: string[];
    /** Text found in source that suggests it. */
    imports?: RegExp;
    /** A docker-compose service image that proves it runs alongside the app. */
    compose?: RegExp;
}

const FRAMEWORKS: Signal[] = [
    { value: 'Next.js', packages: ['next'], files: ['next.config.js', 'next.config.mjs', 'next.config.ts'] },
    { value: 'Remix', packages: ['@remix-run/react'] },
    { value: 'Astro', packages: ['astro'], files: ['astro.config.mjs'] },
    { value: 'Nuxt', packages: ['nuxt'], files: ['nuxt.config.ts'] },
    { value: 'SvelteKit', packages: ['@sveltejs/kit'] },
    { value: 'Angular', packages: ['@angular/core'], files: ['angular.json'] },
    { value: 'Vue', packages: ['vue'] },
    { value: 'React', packages: ['react'] },
    { value: 'Vite', packages: ['vite'], files: ['vite.config.ts', 'vite.config.js'] },
    { value: 'Express', packages: ['express'] },
    { value: 'NestJS', packages: ['@nestjs/core'], files: ['nest-cli.json'] },
    { value: 'Fastify', packages: ['fastify'] },
    { value: 'Hono', packages: ['hono'] },
    { value: 'Django', packages: ['django', 'Django'], files: ['manage.py'] },
    { value: 'FastAPI', packages: ['fastapi'], imports: /^\s*from\s+fastapi\s+import/m },
    { value: 'Flask', packages: ['flask', 'Flask'], imports: /^\s*from\s+flask\s+import/m },
    { value: 'Spring', files: ['pom.xml', 'build.gradle'], imports: /org\.springframework/ },
    { value: 'Flutter', files: ['pubspec.yaml'], imports: /package:flutter\// },
    { value: 'Rails', files: ['Gemfile'], imports: /rails/ },
    { value: 'Laravel', files: ['artisan'] },
    { value: '.NET', files: ['Program.cs'] },
    { value: 'PyTorch', packages: ['torch'], imports: /^\s*import\s+torch\b/m },
    { value: 'TensorFlow', packages: ['tensorflow'], imports: /^\s*import\s+tensorflow\b/m },
    { value: 'scikit-learn', packages: ['scikit-learn'], imports: /from\s+sklearn/ },
];

const DATABASES: Signal[] = [
    { value: 'PostgreSQL', packages: ['pg', 'postgres', 'psycopg', 'psycopg2', 'psycopg2-binary', 'asyncpg', '@vercel/postgres', '@neondatabase/serverless', 'github.com/jackc/pgx/v5', 'github.com/lib/pq'], compose: /image:\s*["']?(?:\S*\/)?postgres/i },
    { value: 'MySQL', packages: ['mysql', 'mysql2', 'pymysql', 'mysqlclient', 'github.com/go-sql-driver/mysql'], compose: /image:\s*["']?(?:\S*\/)?(?:mysql|mariadb)/i },
    { value: 'MongoDB', packages: ['mongodb', 'mongoose', 'pymongo', 'motor', 'beanie', 'go.mongodb.org/mongo-driver'], compose: /image:\s*["']?(?:\S*\/)?mongo/i },
    { value: 'SQLite', packages: ['sqlite3', 'better-sqlite3', 'aiosqlite'] },
    { value: 'Redis', packages: ['redis', 'ioredis', 'aioredis'], compose: /image:\s*["']?(?:\S*\/)?redis/i },
    { value: 'Prisma', packages: ['prisma', '@prisma/client'], files: ['prisma/schema.prisma'] },
    { value: 'Drizzle', packages: ['drizzle-orm'] },
    { value: 'TypeORM', packages: ['typeorm'] },
    { value: 'Sequelize', packages: ['sequelize'] },
    { value: 'SQLAlchemy', packages: ['sqlalchemy'] },
    { value: 'SQLModel', packages: ['sqlmodel'] },
    { value: 'Alembic migrations', packages: ['alembic'] },
    { value: 'Supabase', packages: ['@supabase/supabase-js', 'supabase'] },
    { value: 'Firebase', packages: ['firebase', 'firebase-admin'] },
];

const TESTING: Signal[] = [
    { value: 'Vitest', packages: ['vitest'], files: ['vitest.config.ts'] },
    { value: 'Jest', packages: ['jest'], files: ['jest.config.js', 'jest.config.ts'] },
    { value: 'Playwright', packages: ['@playwright/test'], files: ['playwright.config.ts'] },
    { value: 'Cypress', packages: ['cypress'], files: ['cypress.config.ts'] },
    { value: 'Mocha', packages: ['mocha'] },
    { value: 'pytest', packages: ['pytest'], files: ['pytest.ini', 'conftest.py'] },
    { value: 'unittest', imports: /^\s*import\s+unittest/m },
    { value: 'JUnit', imports: /org\.junit/ },
    { value: 'Go test', files: ['go.mod'], imports: /func\s+Test[A-Z]/ },
];

function matchSignals(signals: Signal[], input: RepoInput, deps: DependencyInfo[]): Finding[] {
    const depNames = new Map(deps.map((d) => [normalizePackage(d.name), d]));
    const pathSet = new Set(input.paths);
    const dirs = new Set(input.paths.map((p) => p.split('/')[0] ?? ''));
    const composeFiles = input.files.filter((f) => /(^|\/)(docker-)?compose[\w.-]*\.ya?ml$/.test(f.path));
    const found: Finding[] = [];

    for (const signal of signals) {
        const evidence: string[] = [];
        let confidence: Finding['confidence'] | undefined;

        for (const name of signal.packages ?? []) {
            const dep = depNames.get(normalizePackage(name));
            if (dep) {
                evidence.push(`${dep.source ?? 'manifest'} → ${dep.name}`);
                confidence = 'detected';
            }
        }
        if (signal.compose) {
            const compose = composeFiles.find((f) => signal.compose!.test(f.text));
            if (compose) {
                evidence.push(`${compose.path} → service image`);
                confidence = 'detected';
            }
        }
        for (const file of signal.files ?? []) {
            if (pathSet.has(file)) {
                evidence.push(file);
                confidence ??= 'detected';
            }
        }
        for (const dir of signal.dirs ?? []) {
            if (dirs.has(dir)) {
                evidence.push(`${dir}/`);
                confidence ??= 'inferred';
            }
        }
        if (signal.imports && evidence.length < 2) {
            const hit = input.files.find((f) => signal.imports!.test(f.text));
            if (hit) {
                evidence.push(hit.path);
                confidence ??= 'inferred';
            }
        }
        if (confidence && evidence.length) {
            found.push({ value: signal.value, confidence, evidence: evidence.slice(0, 4) });
        }
    }
    return found;
}

/** Frameworks, most specific first: Next.js outranks the React it is built on. */
export function detectFrameworks(input: RepoInput, deps: DependencyInfo[]): Finding[] {
    const found = matchSignals(FRAMEWORKS, input, deps);
    const names = new Set(found.map((f) => f.value));
    // A meta-framework implies its base; showing both is noise.
    const implied: Record<string, string[]> = {
        'Next.js': ['React', 'Vite'],
        Remix: ['React', 'Vite'],
        Astro: ['Vite'],
        Nuxt: ['Vue', 'Vite'],
        SvelteKit: ['Vite'],
        Angular: ['Vite'],
        NestJS: ['Express'],
    };
    const hidden = new Set<string>();
    for (const name of names) for (const base of implied[name] ?? []) hidden.add(base);
    return found.filter((f) => !hidden.has(f.value));
}

export function detectDatabases(input: RepoInput, deps: DependencyInfo[]): Finding[] {
    return matchSignals(DATABASES, input, deps);
}

export function detectTesting(input: RepoInput, deps: DependencyInfo[]): Finding[] {
    return matchSignals(TESTING, input, deps);
}

const IMPORTANT = [
    'README.md', 'readme.md', 'ARCHITECTURE.md', 'CONTRIBUTING.md', 'AGENTS.md', 'CLAUDE.md',
    'package.json', 'tsconfig.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod',
    'pom.xml', 'build.gradle', 'pubspec.yaml', 'Gemfile', 'composer.json',
    'next.config.js', 'next.config.mjs', 'next.config.ts', 'vite.config.ts', 'nuxt.config.ts',
    'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'Makefile',
    'prisma/schema.prisma', '.env.example', 'vercel.json', 'turbo.json', 'nx.json',
];

export function detectImportantFiles(input: RepoInput): string[] {
    const pathSet = new Set(input.paths);
    // READMEs are spelled every way (Readme.md, README.rst, readme.txt).
    const readmes = input.paths.filter((p) => /^readme(\.[a-z]+)?$/i.test(p));
    const found = IMPORTANT.filter((file) => pathSet.has(file) && !/^readme/i.test(file));
    // Sub-projects matter too — their READMEs and manifests, a handful of each.
    const nested = input.paths
        .filter((p) => /^[^/]+\/(readme\.md|package\.json|pyproject\.toml|go\.mod|Cargo\.toml)$/i.test(p) || /^(apps|packages|services)\/[^/]+\/package\.json$/.test(p))
        .filter((p) => !/^(examples?|test|tests|fixtures?|docs?)\//i.test(p))
        .slice(0, 10);
    return [...new Set([...readmes, ...found, ...nested])];
}

const SECRET_PATTERNS: [RegExp, string][] = [
    [/AIza[0-9A-Za-z_-]{30,}/g, 'Google API key'],
    [/gsk_[A-Za-z0-9]{20,}/g, 'Groq API key'],
    [/csk-[A-Za-z0-9]{20,}/g, 'Cerebras API key'],
    [/sk-(?:or-v1-|proj-|ant-)[A-Za-z0-9_-]{20,}/g, 'AI provider key'],
    [/gh[pousr]_[A-Za-z0-9]{20,}/g, 'GitHub token'],
    [/xox[baprs]-[A-Za-z0-9-]{10,}/g, 'Slack token'],
    [/AKIA[0-9A-Z]{16}/g, 'AWS access key'],
    [/-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/g, 'Private key'],
    [/aws_secret_access_key\s*=\s*\S+/gi, 'AWS secret'],
];

/** `.env`, `.env.local`, `.env.production` — but not `.env.example` or `.env.sample`. */
export function isSecretFile(path: string): boolean {
    return /(^|\/)\.env(\.[\w-]+)?$/.test(path) && !/\.(example|sample|template|dist)$/.test(path);
}

/**
 * Strip anything that looks like a credential before text leaves the server
 * for a model provider. Repositories are untrusted and often leak keys.
 */
export function redactSecrets(text: string): string {
    let out = text;
    for (const [re, kind] of SECRET_PATTERNS) out = out.replace(re, `[redacted ${kind}]`);
    // KEY=value lines whose name says secret.
    return out.replace(/^(\s*[\w.-]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY)[\w.-]*\s*[=:]\s*)(["']?)[^\s"'#]{6,}\2/gim, '$1[redacted]');
}

/** Anything that looks like a committed secret. Reported, never echoed. */
export function findPossibleSecrets(files: RepoFile[]): { path: string; kind: string }[] {
    const hits: { path: string; kind: string }[] = [];
    for (const file of files) {
        if (isSecretFile(file.path)) {
            hits.push({ path: file.path, kind: 'Committed .env file' });
            continue;
        }
        for (const [re, kind] of SECRET_PATTERNS) {
            re.lastIndex = 0;
            if (re.test(file.text)) {
                hits.push({ path: file.path, kind });
                break;
            }
        }
    }
    return hits;
}
