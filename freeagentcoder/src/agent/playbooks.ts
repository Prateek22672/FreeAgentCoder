import type { Tier } from '../shared/protocol';

/**
 * Senior-engineer playbooks: what a production-quality project in a given
 * stack needs (structure, checks, security, release steps). A matching
 * playbook is added to complex build tasks as a brief, and its quality gates
 * are checked against the commands the agent actually ran before it may finish.
 */

export type GateStatus = 'passed' | 'failed' | 'not_run';
type Requirement = 'always' | 'release' | 'optional';

export interface QualityGate {
    id: string;
    label: string;
    command: string;
    /** Recognizes this gate in a run_command command line. */
    matches: RegExp;
    required: Requirement;
}

export interface Playbook {
    id: string;
    name: string;
    request: RegExp;
    /** Files in the project root that mean the project already uses this stack. */
    projectFiles: string[];
    toolchains: string[];
    guide: string[];
    gates: QualityGate[];
    security: string[];
    release: string[];
}

export interface CommandRun {
    command: string;
    exitCode: number | null;
    background: boolean;
}

export interface GateResult {
    label: string;
    command: string;
    required: boolean;
    status: GateStatus;
    exitCode?: number | null;
}

const PM = String.raw`(?:npm|pnpm|yarn|bun)`;

const FLUTTER: Playbook = {
    id: 'flutter',
    name: 'Flutter',
    request: /\b(?:flutter|dart)\b/i,
    projectFiles: ['pubspec.yaml'],
    toolchains: ['flutter', 'dart', 'java', 'android'],
    guide: [
        'Create apps with `flutter create --org com.<yourname> --project-name <snake_case_name> <folder>` so the application ID is not com.example. Keep `publish_to: none` in pubspec.yaml for apps.',
        'Structure: lib/main.dart only starts the app; code lives in lib/src/ (models/, services/, state/, screens/, widgets/). Keep widgets small and pass BuildContext into helper methods (a StatelessWidget has no context field).',
        'Use one state approach (provider or riverpod) consistently, keep business logic out of widgets, and rewrite test/widget_test.dart to test the real app.',
        'Add packages with `flutter pub add <package>`, only ones you use. Use bundled assets or URLs you have verified; never invent image or API URLs.',
        'Platform features (setting the wallpaper, camera, storage) need a real plugin or platform channel plus the matching Android and iOS permissions. Never fake a feature with a label.',
        'Run the app to check it: `flutter run -d windows` or `flutter run -d chrome` with background=true, then read its output with the process tool.',
    ],
    gates: [
        { id: 'format', label: 'Formatting', command: 'dart format --output=none --set-exit-if-changed lib test', matches: /\bdart\s+format\b/, required: 'optional' },
        { id: 'analyze', label: 'Static analysis', command: 'flutter analyze', matches: /\b(?:flutter|dart)\s+analyze\b/, required: 'always' },
        { id: 'test', label: 'Tests', command: 'flutter test', matches: /\bflutter\s+test\b/, required: 'always' },
        {
            id: 'build',
            label: 'Release build',
            command: 'flutter build apk --release',
            matches: /\bflutter\s+build\s+(?:apk|appbundle|ipa|ios|web|windows|macos|linux)\b/,
            required: 'release',
        },
    ],
    security: [
        'No API keys or secrets in Dart code or assets (use --dart-define or a backend).',
        'HTTPS only, with no cleartext traffic allowed in AndroidManifest.xml.',
        'Request only the permissions the app actually uses.',
        'key.properties and the upload keystore are kept out of git.',
        'Release builds use --obfuscate --split-debug-info.',
    ],
    release: [
        'A unique application ID (not com.example) and a real app name.',
        'Version and build number set in pubspec.yaml.',
        'Release signing configured in android/app/build.gradle(.kts) from key.properties.',
        'Launcher icons and splash screen (for example with flutter_launcher_icons).',
        'Target SDK meets the current Google Play requirement.',
        'Privacy policy URL, store listing text and screenshots.',
    ],
};

const WEB: Playbook = {
    id: 'web',
    name: 'Web app',
    request: /\b(?:react(?!\s*native)|next\.?js|vite|vue|svelte|angular|astro|website|web\s*app|web\s*site|landing\s+page|dashboard|frontend|front-end)\b/i,
    projectFiles: [
        'vite.config.ts',
        'vite.config.js',
        'vite.config.mjs',
        'next.config.js',
        'next.config.mjs',
        'next.config.ts',
        'svelte.config.js',
        'astro.config.mjs',
        'angular.json',
    ],
    toolchains: ['node', 'npm'],
    guide: [
        'If no stack is named, use Vite + React + TypeScript + Tailwind CSS in a new folder, created with non-interactive flags. Remove template leftovers you do not use.',
        'Structure: src/components/, src/pages/ (or routes/), src/hooks/, src/lib/; small typed components.',
        'Everything in client code is public: only VITE_ or NEXT_PUBLIC_ variables reach the browser, never secrets.',
        'Accessible (labels, alt text, keyboard focus) and responsive at phone width, with loading and error states.',
        'Check it runs: start the dev server with background=true, then fetch_url the local URL or read the process output.',
    ],
    gates: [
        {
            id: 'typecheck',
            label: 'Type check',
            command: 'npx tsc --noEmit',
            matches: new RegExp(String.raw`\btsc\b|\b${PM}\s+(?:run\s+)?(?:typecheck|type-check|check-types|check)\b`),
            required: 'optional',
        },
        { id: 'lint', label: 'Lint', command: 'npm run lint', matches: new RegExp(String.raw`\b${PM}\s+(?:run\s+)?lint\b|\beslint\b|\bbiome\s+(?:check|lint)\b`), required: 'optional' },
        { id: 'test', label: 'Tests', command: 'npm test', matches: new RegExp(String.raw`\b${PM}\s+(?:run\s+)?test\b|\bvitest\b|\bjest\b|\bplaywright\s+test\b`), required: 'optional' },
        { id: 'build', label: 'Production build', command: 'npm run build', matches: new RegExp(String.raw`\b${PM}\s+(?:run\s+)?build\b|\b(?:next|vite|astro|ng)\s+build\b`), required: 'always' },
    ],
    security: [
        'No secrets or private API keys in client code or committed .env files.',
        'User input is never rendered as raw HTML (no dangerouslySetInnerHTML or v-html with user data).',
        'Dependencies checked with `npm audit --omit=dev`.',
        'Security headers (CSP, HTTPS redirect) set on the host.',
    ],
    release: [
        'The production build passes with no type errors.',
        'Page titles, meta description, favicon and social preview image.',
        '.env.example documents every variable.',
        'Deploy config for the chosen host (vercel.json, netlify.toml or a Dockerfile).',
        'A 404 page and no broken links.',
    ],
};

const NODE_API: Playbook = {
    id: 'node-api',
    name: 'Node.js API',
    request: /\b(?:express|fastify|nestjs|hono|koa|node(?:\.js)?\s+(?:api|server|backend)|rest\s*api|graphql\s+(?:api|server)|api\s+server)\b/i,
    projectFiles: [],
    toolchains: ['node', 'npm'],
    guide: [
        'Structure: src/routes/, src/services/, src/db/, src/middleware/, src/config.ts; validate every request body and query (for example with zod).',
        'Configuration from environment variables with an .env.example; fail fast when one is missing.',
        'Consistent JSON errors with correct status codes, and a GET /health endpoint.',
        'Check it runs: start the server with background=true, then fetch_url its /health endpoint.',
    ],
    gates: [
        {
            id: 'typecheck',
            label: 'Type check',
            command: 'npx tsc --noEmit',
            matches: new RegExp(String.raw`\btsc\b|\b${PM}\s+(?:run\s+)?(?:typecheck|type-check|check-types|build)\b`),
            required: 'optional',
        },
        { id: 'test', label: 'Tests', command: 'npm test', matches: new RegExp(String.raw`\b${PM}\s+(?:run\s+)?test\b|\bvitest\b|\bjest\b|\bnode\s+--test\b`), required: 'always' },
    ],
    security: [
        'All input validated and size-limited.',
        'Parameterized queries or an ORM; no SQL built from strings.',
        'Passwords hashed with bcrypt or argon2; tokens signed with a secret from the environment.',
        'helmet, rate limiting and a CORS allowlist.',
        'Secrets only in environment variables, with .env in .gitignore.',
    ],
    release: [
        'Health check and graceful shutdown.',
        'Structured logging that never prints secrets.',
        'A Dockerfile or deploy config.',
        'Database migrations committed.',
        '.env.example lists every variable.',
    ],
};

const PYTHON_API: Playbook = {
    id: 'python-api',
    name: 'Python backend',
    request: /\b(?:fastapi|django|flask|python\s+(?:api|backend|server|web\s*app))\b/i,
    projectFiles: ['manage.py'],
    toolchains: ['python', 'uv', 'poetry'],
    guide: [
        'Work in a virtual environment (uv, poetry or python -m venv .venv) and pin dependencies.',
        'Structure: app/ (routers or views, models, schemas, services) and tests/; settings from environment variables.',
        'Validate input with pydantic or forms and return proper status codes.',
        'Check it runs: start uvicorn or `manage.py runserver` with background=true, then fetch_url a health or home URL.',
    ],
    gates: [
        { id: 'lint', label: 'Lint', command: 'ruff check .', matches: /\bruff\b|\bflake8\b|\bpylint\b/, required: 'optional' },
        { id: 'types', label: 'Type check', command: 'mypy .', matches: /\bmypy\b|\bpyright\b/, required: 'optional' },
        { id: 'test', label: 'Tests', command: 'python -m pytest', matches: /\bpytest\b|\bmanage\.py\s+test\b/, required: 'always' },
    ],
    security: [
        'DEBUG off and SECRET_KEY read from the environment in production.',
        'ORM or parameterized SQL only.',
        'Passwords hashed with argon2 or bcrypt; CSRF protection on forms; CORS allowlist.',
        'Pinned dependencies checked with pip-audit.',
    ],
    release: [
        'Locked dependencies (uv.lock, poetry.lock or a pinned requirements.txt).',
        'Migrations committed.',
        'A production server (gunicorn or uvicorn workers) and a Dockerfile.',
        'A health check endpoint.',
        '.env.example lists every variable.',
    ],
};

const ML: Playbook = {
    id: 'ml',
    name: 'Machine learning',
    request:
        /\b(?:machine\s+learning|deep\s+learning|ml\s+(?:model|pipeline|project|app)|neural\s+net\w*|train(?:ing)?\s+(?:a\s+)?model|fine-?tun\w*|pytorch|tensorflow|keras|scikit-learn|sklearn|hugging\s*face|transformers)\b/i,
    projectFiles: [],
    toolchains: ['python', 'uv', 'conda'],
    guide: [
        'Structure: src/ (data.py, model.py, train.py, evaluate.py), configs/, notebooks/; data/ and models/ git-ignored.',
        'Reproducible: fixed seeds, pinned versions, hyperparameters in a config file or CLI arguments rather than hard-coded.',
        'Never load a whole dataset to look at it; check shapes and a few rows.',
        'Prove the pipeline end to end with a smoke run: a tiny subset, one epoch or a few batches, on CPU if there is no GPU.',
        'Log metrics and save checkpoints to models/ together with the config used.',
    ],
    gates: [
        {
            id: 'smoke',
            label: 'Smoke run on a tiny subset',
            command: 'python src/train.py --epochs 1 --limit 100',
            matches: /\bpython3?\b[^\n]*\b(?:train|fit|main|run|pipeline|evaluate|predict|infer)\w*\.py\b|\bpython3?\s+-m\s+\S*(?:train|main)\b/,
            required: 'always',
        },
        { id: 'test', label: 'Tests', command: 'python -m pytest', matches: /\bpytest\b/, required: 'optional' },
        { id: 'lint', label: 'Lint', command: 'ruff check .', matches: /\bruff\b|\bflake8\b/, required: 'optional' },
    ],
    security: [
        'No datasets with personal data, model weights or tokens (HF_TOKEN, API keys) committed to git.',
        'Pickle or torch checkpoints only loaded from trusted sources.',
        'Licenses of datasets and pretrained models checked.',
    ],
    release: [
        'README explains setup, getting the data, and reproducing the results.',
        'Locked dependencies.',
        'Evaluation metrics recorded with the config that produced them.',
        'A model card for any published model.',
    ],
};

const GENERAL: Playbook = {
    id: 'general',
    name: 'Project',
    request: /(?!)/,
    projectFiles: [],
    toolchains: [],
    guide: [
        "Choose a well-supported stack for the job and say why in one line, then follow that ecosystem's standard layout and tooling.",
        'Check it runs: start it (background=true for servers) and confirm it responds or prints the expected output.',
    ],
    gates: [
        {
            id: 'verify',
            label: 'Build or tests',
            command: "the project's build or test command",
            matches: /\b(?:build|test|tsc|compile|pytest|vitest|jest|analyze|check)\b/,
            required: 'always',
        },
    ],
    security: ['No secrets committed; configuration from environment variables.', "Input validated, using the ecosystem's safe defaults.", 'Dependencies kept minimal and current.'],
    release: ['README with setup, run and test instructions.', 'A license file.', 'Build and tests pass on a clean checkout.'],
};

export const PLAYBOOKS: Playbook[] = [FLUTTER, ML, PYTHON_API, NODE_API, WEB];

const BUILD_INTENT =
    /\b(?:build|create|make|develop|scaffold|generate|set\s*up|write|design|clone|train|fine-?tune)\b[\s\S]{0,80}?\b(?:app|application|website|site|web\s*app|project|api|backend|server|service|game|extension|bot|dashboard|platform|pipeline|model|tool|cli)\b/i;
const CHANGE_INTENT = /\b(?:fix|debug|refactor|upgrade|migrate|implement|add|integrate|optimi[sz]e|improve)\b/i;
const RELEASE_INTENT = /\b(?:publish\w*|release|production|deploy\w*|play\s*store|app\s*store|apk|aab|ready\s+to\s+(?:ship|launch))\b/i;
const MOBILE = /\b(?:mobile|android|ios|iphone|cross-platform)\s+(?:app|application)\b|\bapp\s+for\s+(?:android|ios)\b/i;
const OTHER_MOBILE = /\b(?:react\s*native|expo|kotlin|swift(?:ui)?|jetpack\s+compose|ionic|capacitor|xamarin|maui)\b/i;
const EXPLAINS_BLOCKER = /\b(?:not installed|isn't installed|is not installed|missing|cannot run|can't run|couldn't run|could not run|unable to run|not available)\b/i;

export function releaseIntent(prompt: string): boolean {
    return RELEASE_INTENT.test(prompt);
}

/** Playbooks for a deep build or change task, or none for questions and small work. */
export function choosePlaybooks(prompt: string, tier: Tier, rootFiles: ReadonlySet<string>): Playbook[] {
    if (tier !== 'deep') {
        return [];
    }
    const build = BUILD_INTENT.test(prompt) || RELEASE_INTENT.test(prompt);
    if (!build && !CHANGE_INTENT.test(prompt)) {
        return [];
    }
    const matched = PLAYBOOKS.filter((playbook) => playbook.request.test(prompt));
    if (!matched.length && MOBILE.test(prompt) && !OTHER_MOBILE.test(prompt)) {
        matched.push(FLUTTER);
    }
    if (!matched.length) {
        const fromProject = PLAYBOOKS.find((playbook) => playbook.projectFiles.some((file) => rootFiles.has(file)));
        if (fromProject) {
            matched.push(fromProject);
        }
    }
    if (matched.length) {
        return matched.slice(0, 2);
    }
    return build ? [GENERAL] : [];
}

function isRequired(gate: QualityGate, release: boolean): boolean {
    return gate.required === 'always' || (gate.required === 'release' && release);
}

export function buildBrief(playbooks: Playbook[], release: boolean, request: string): string {
    const toolchains = [...new Set(playbooks.flatMap((p) => p.toolchains))];
    const lines = [
        '<task-brief source="FreeAgentCoder">',
        'The editor added this brief because this is a complex task. Follow it; the user did not type it.',
        '',
        '## How to work',
        `1. Preflight: call inspect_environment${toolchains.length ? ` with ${JSON.stringify(toolchains)}` : ' for the tools this task needs'}. If a required tool is missing, stop and tell the user exactly what to install and where to get it. Ask before installing SDKs, running system package managers, or changing PATH or shell profiles.`,
        '2. Plan with todo_write: concrete steps that end with the quality gates below.',
        '3. Build in small steps. After each milestone, run the matching gate and fix what it reports before moving on.',
        '4. Use only real packages, APIs and URLs you have checked. Never fake a feature with a placeholder.',
        '5. Do not finish until every required gate has passed, or you have clearly explained why one cannot run here.',
        `6. End with the usual report plus a "### Security" section${release ? ' and a "### Before publishing" section' : ''}, saying what is done and what the user still has to do.`,
    ];
    for (const playbook of playbooks) {
        lines.push('', `## ${playbook.name} playbook`, ...playbook.guide.map((item) => `- ${item}`), '', '### Quality gates');
        for (const gate of playbook.gates) {
            lines.push(`- ${gate.label}${isRequired(gate, release) ? ' (required)' : ''}: \`${gate.command}\``);
        }
        lines.push('', '### Security', ...playbook.security.map((item) => `- ${item}`));
        if (release) {
            lines.push('', '### Before publishing', ...playbook.release.map((item) => `- ${item}`));
        }
    }
    lines.push('</task-brief>', '', '## Request', request);
    return lines.join('\n');
}

export function evaluateGates(playbooks: Playbook[], runs: CommandRun[], release: boolean): GateResult[] {
    const prefix = playbooks.length > 1;
    return playbooks.flatMap((playbook) =>
        playbook.gates.map((gate) => {
            const run = [...runs].reverse().find((r) => !r.background && gate.matches.test(r.command));
            return {
                label: prefix ? `${playbook.name}: ${gate.label}` : gate.label,
                command: gate.command,
                required: isRequired(gate, release),
                status: !run ? 'not_run' : run.exitCode === 0 ? 'passed' : 'failed',
                exitCode: run?.exitCode,
            } satisfies GateResult;
        }),
    );
}

/** A message sending the agent back to work, or undefined when it may finish. */
export function reviewMessage(results: GateResult[], finalReply: string): string | undefined {
    const reply = finalReply.trim();
    if (reply.endsWith('?') || EXPLAINS_BLOCKER.test(reply)) {
        return undefined;
    }
    const missing = results.filter((r) => r.required && r.status !== 'passed');
    if (!missing.length) {
        return undefined;
    }
    return [
        'Not done yet: these required quality gates have not passed.',
        ...missing.map(
            (r) =>
                `- ${r.label}: ${r.status === 'failed' ? `failed (exit ${r.exitCode})` : 'not run'}. Run \`${r.command}\` in the project folder and fix what it reports.`,
        ),
        'Run them now. If one truly cannot run here (for example a required SDK is missing), stop and say so clearly in your final reply instead of retrying.',
    ].join('\n');
}
