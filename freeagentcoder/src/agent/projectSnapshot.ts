import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const NODE_FRAMEWORKS: [string, string][] = [
    ['next', 'Next.js'],
    ['nuxt', 'Nuxt'],
    ['@angular/core', 'Angular'],
    ['@sveltejs/kit', 'SvelteKit'],
    ['svelte', 'Svelte'],
    ['vue', 'Vue'],
    ['react-native', 'React Native'],
    ['expo', 'Expo'],
    ['react', 'React'],
    ['astro', 'Astro'],
    ['electron', 'Electron'],
    ['@nestjs/core', 'NestJS'],
    ['express', 'Express'],
    ['fastify', 'Fastify'],
    ['vite', 'Vite'],
    ['tailwindcss', 'Tailwind'],
    ['prisma', 'Prisma'],
    ['vitest', 'Vitest'],
    ['jest', 'Jest'],
];

const PYTHON_LIBRARIES = [
    'torch',
    'tensorflow',
    'jax',
    'keras',
    'transformers',
    'lightning',
    'scikit-learn',
    'xgboost',
    'pandas',
    'numpy',
    'polars',
    'langchain',
    'fastapi',
    'django',
    'flask',
    'streamlit',
    'pytest',
];

const USEFUL_SCRIPTS = /^(dev|start|build|test|lint|typecheck|check-types|check|format)$/;

/**
 * A few lines about the project's stack and commands, detected from files in
 * its root. It saves the agent exploration steps on every task.
 */
export async function projectSnapshot(root: string): Promise<string> {
    let names: Set<string>;
    try {
        names = new Set(await fs.readdir(root));
    } catch {
        return '';
    }
    const read = (file: string) => fs.readFile(path.join(root, file), 'utf8').catch(() => '');
    const facts: string[] = [];

    if (names.has('package.json')) {
        try {
            const pkg = JSON.parse(await read('package.json')) as {
                scripts?: Record<string, string>;
                dependencies?: Record<string, string>;
                devDependencies?: Record<string, string>;
                workspaces?: unknown;
            };
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            const manager = names.has('pnpm-lock.yaml') ? 'pnpm' : names.has('yarn.lock') ? 'yarn' : names.has('bun.lockb') || names.has('bun.lock') ? 'bun' : 'npm';
            const language = 'typescript' in deps || names.has('tsconfig.json') ? 'TypeScript' : 'JavaScript';
            const frameworks = NODE_FRAMEWORKS.filter(([dep]) => dep in deps).map(([, label]) => label);
            const scripts = Object.keys(pkg.scripts ?? {})
                .filter((name) => USEFUL_SCRIPTS.test(name))
                .map((name) => `${manager} run ${name}`);
            facts.push(
                `${language} with ${manager}${pkg.workspaces ? ' (workspaces monorepo)' : ''}${frameworks.length ? `: ${frameworks.join(', ')}` : ''}.${
                    scripts.length ? ` Scripts: ${scripts.join(', ')}.` : ''
                }`,
            );
        } catch {
            facts.push('Node.js project (package.json could not be parsed).');
        }
    }

    const pythonMarkers = ['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'Pipfile', 'environment.yml', 'environment.yaml', 'uv.lock', 'poetry.lock'];
    if (pythonMarkers.some((file) => names.has(file))) {
        const pyproject = names.has('pyproject.toml') ? await read('pyproject.toml') : '';
        const manifests = `${pyproject}\n${names.has('requirements.txt') ? await read('requirements.txt') : ''}\n${
            names.has('environment.yml') ? await read('environment.yml') : ''
        }`;
        const tool = names.has('uv.lock')
            ? 'uv'
            : names.has('poetry.lock') || pyproject.includes('[tool.poetry]')
              ? 'poetry'
              : names.has('environment.yml') || names.has('environment.yaml')
                ? 'conda'
                : names.has('Pipfile')
                  ? 'pipenv'
                  : 'pip';
        const venv = ['.venv', 'venv'].find((dir) => names.has(dir));
        const libraries = PYTHON_LIBRARIES.filter((lib) => new RegExp(`(^|[\\s"'\\[,-])${lib}(?=[\\s=<>~!\\[;"',]|$)`, 'im').test(manifests));
        facts.push(`Python with ${tool}${venv ? `, virtualenv in ${venv}/` : ''}${libraries.length ? `: ${libraries.join(', ')}` : ''}.`);
    }

    if ([...names].some((name) => name.endsWith('.ipynb')) || names.has('notebooks')) {
        facts.push('Jupyter notebooks are present.');
    }

    const others: [boolean, string][] = [
        [names.has('Cargo.toml'), 'Rust (cargo build, cargo test)'],
        [names.has('go.mod'), 'Go (go build ./..., go test ./...)'],
        [names.has('pom.xml'), 'Java with Maven'],
        [names.has('build.gradle') || names.has('build.gradle.kts'), 'JVM with Gradle'],
        [[...names].some((name) => /\.(sln|csproj)$/.test(name)), '.NET (dotnet build, dotnet test)'],
        [names.has('Gemfile'), 'Ruby with Bundler'],
        [names.has('composer.json'), 'PHP with Composer'],
        [names.has('pubspec.yaml'), 'Dart/Flutter'],
        [names.has('Dockerfile') || names.has('docker-compose.yml') || names.has('compose.yaml'), 'Docker'],
    ];
    const extra = others.filter(([present]) => present).map(([, label]) => label);
    if (extra.length) {
        facts.push(`Also: ${extra.join('; ')}.`);
    }

    return facts.length ? `# Project snapshot (detected from root files; confirm before relying on it)\n- ${facts.join('\n- ')}` : '';
}
