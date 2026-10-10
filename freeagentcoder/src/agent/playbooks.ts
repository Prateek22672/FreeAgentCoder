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
    /**
     * Files that mean there is something to build or test ("*.ext" matches by
     * ending). When set and none is near the files a task changed, the gates do
     * not apply: a plain HTML page has no build to pass.
     */
    manifests?: string[];
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
    manifests: ['package.json'],
    guide: [
        'If no stack is named: a page or small site with no app state is plain HTML, CSS and JavaScript in its own folder (index.html, css/, js/, assets/), with no npm and no build. An app with screens, state or data is Vite + React + TypeScript + Tailwind CSS in a new folder, created with non-interactive flags; remove template leftovers you do not use.',
        'Structure for an app: src/components/, src/pages/ (or routes/), src/hooks/, src/lib/; small typed components.',
        'Everything in client code is public: only VITE_ or NEXT_PUBLIC_ variables reach the browser, never secrets.',
        'Accessible (labels, alt text, keyboard focus) and responsive at phone width, with loading and error states.',
        'Check it runs. An app: start the dev server with background=true, then fetch_url the local URL or read the process output. Plain files: load the page with check_page and fix every error it reports, then call it with a script that uses the main controls and returns what changed; the editor shows the page to the user when you finish, so do not start a server for it.',
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
    manifests: ['package.json'],
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
    toolchains: ['python'],
    guide: [
        'Work in a virtual environment: uv if it is installed, otherwise python -m venv .venv, which always works. Never stop to ask about uv or poetry. Pin dependencies.',
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
    toolchains: ['python'],
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

/**
 * Slides, PDFs, Word and Excel files made by a script. The guide holds the
 * mistakes that cost real tasks most: colour formats that differ between
 * python-pptx and matplotlib, paths that only work from one folder, and
 * converters that are rarely installed.
 */
const DOCUMENTS: Playbook = {
    id: 'documents',
    name: 'Documents and presentations',
    request: /\b(?:pptx?|power\s*point|slides?|slide\s*deck|presentation|pdf|docx|word\s+(?:doc|document|file)|xlsx|spreadsheet|excel\s+(?:file|sheet|report)|report|infographic|poster|brochure|handout)\b/i,
    projectFiles: [],
    toolchains: ['python'],
    manifests: ['*.py'],
    guide: [
        'One build script (build_<name>.py) makes every output: the figures, the deck or document, and the PDF. After any change, run the script again; never edit an output by hand.',
        'Paths from the script itself: HERE = os.path.dirname(os.path.abspath(__file__)), and every figure and output joined to HERE, so it runs from any folder. Write each figure to the exact name the slide code reads.',
        'Colours: keep the palette as hex strings ("1B2A33"). python-pptx takes RGBColor.from_string("1B2A33") (or three 0-255 ints); matplotlib takes "#1B2A33". Never pass an RGBColor or a 0-255 tuple to matplotlib. Write one helper for each and use them everywhere.',
        'Slides: widescreen 13.333 x 7.5 in, one helper per layout (title, bullets, image with caption, two columns), at most 6 short bullets, text 18 pt or larger, nothing outside the slide. Exactly the number of slides asked for.',
        'Charts and diagrams with matplotlib (Agg backend), 200 dpi PNGs, labelled axes, one idea per figure. Flowcharts as boxes and arrows drawn with matplotlib patches.',
        'PDF: build it in the same script (matplotlib PdfPages, or reportlab drawing the same pages). Do not try LibreOffice, unoconv or PowerPoint automation unless inspect_environment found them.',
        'Facts about real events: use what you know with care, round figures and mark them "approx.", never present an invented precise number as fact, and end with a sources or notes slide.',
        'Write text files with encoding="utf-8". Check the result in the same run: reopen each output (Presentation(path), the PDF page count) and print one line per slide or page with its title.',
    ],
    gates: [
        {
            id: 'build',
            label: 'Build script run',
            command: 'python build_<name>.py',
            matches: /\bpython3?\b[^|;&]*\.py\b/,
            required: 'always',
        },
    ],
    security: ['No personal data or API keys in the document or the script.'],
    release: ['The script, its outputs and a short README on how to rebuild them.'],
};

const DOTNET: Playbook = {
    id: 'dotnet',
    name: '.NET',
    request: /\b(?:asp\.?net|\.net\s*(?:core|\d)|blazor|razor\s+pages|entity\s*framework|ef\s*core|c#|csharp)\b/i,
    projectFiles: ['global.json', 'Directory.Build.props'],
    toolchains: ['dotnet'],
    manifests: ['*.csproj', '*.sln'],
    guide: [
        'Create with the dotnet CLI and non-interactive flags (dotnet new mvc -n Name, dotnet new webapi). Add packages with dotnet add package, pinned to the SDK major version.',
        'Configuration in appsettings.json with secrets from user-secrets or environment variables; EF Core migrations or EnsureCreated plus a seed for a demo.',
        'Check it: dotnet build with no warnings, then dotnet run with background=true and fetch_url the home page and one API endpoint.',
    ],
    gates: [
        { id: 'build', label: 'Build', command: 'dotnet build', matches: /\bdotnet\s+build\b/, required: 'always' },
        { id: 'test', label: 'Tests', command: 'dotnet test', matches: /\bdotnet\s+test\b/, required: 'optional' },
    ],
    security: [
        'ASP.NET Core Identity for passwords, lockout and roles; never a custom password table.',
        'Anti-forgery on every state-changing form; EF Core queries only, no SQL built from input.',
        'Authorization on the server for every page and endpoint, not only hidden links.',
    ],
    release: ['Production appsettings with HTTPS and HSTS, secrets outside source control, and a README with run steps and demo logins.'],
};

const GENERAL: Playbook = {
    id: 'general',
    name: 'Project',
    request: /(?!)/,
    projectFiles: [],
    toolchains: [],
    manifests: [
        'package.json',
        'pyproject.toml',
        'requirements.txt',
        'setup.py',
        'Cargo.toml',
        'go.mod',
        'pom.xml',
        'build.gradle',
        'build.gradle.kts',
        'pubspec.yaml',
        'composer.json',
        'Gemfile',
        'Makefile',
        'CMakeLists.txt',
        '*.csproj',
        '*.sln',
    ],
    guide: [
        'Pick the simplest stack that does the job well, and say why in one line. Something that runs in a browser with no backend (a game, a calculator, a small tool) is plain HTML, CSS and JavaScript: no framework, no npm, no build, no test runner. Use a framework or a toolchain only when the request names one or the project needs one.',
        'A new project goes in its own folder, named after it, with files grouped: for plain web files index.html, css/, js/ and assets/.',
        'Simple is not unfinished. Build every rule and feature the request implies (a board game: the board, the pieces, dice, turns, special squares, a winner and a restart), with a designed interface: a real layout, a considered palette, hover and focus states, and it fits a phone screen. Nothing stubbed, no placeholder text.',
        'Check it for real. With a toolchain: its build or tests. A plain web page: load it with check_page, which runs it in a real browser and reports its errors and anything cut off, and fix every one; then call check_page with a script that uses each main feature like a user (click, wait, read the result) and returns the values that prove it works, and fix what is wrong. A server: start it with background=true and confirm it responds. The editor shows a web page to the user when you finish, so do not start a server just to show a static page.',
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

export const PLAYBOOKS: Playbook[] = [FLUTTER, ML, DOTNET, PYTHON_API, NODE_API, WEB];

/** Asking for a document to be made, in any wording: "i need a ppt…", "generate a pdf…". */
const DOCUMENT_INTENT = /\b(?:need|want|make|create|generate|build|prepare|produce|write|design|give\s+me)\b/i;

const BUILD_INTENT =
    /\b(?:build|create|make|develop|scaffold|generate|set\s*up|write|design|clone|train|fine-?tune)\b[\s\S]{0,80}?\b(?:app|application|website|site|web\s*app|project|api|backend|server|service|game|extension|bot|dashboard|platform|pipeline|model|tool|cli)\b/i;
const CHANGE_INTENT = /\b(?:fix|debug|refactor|upgrade|migrate|implement|add|integrate|optimi[sz]e|improve)\b/i;
const RELEASE_INTENT = /\b(?:publish\w*|release|production|deploy\w*|play\s*store|app\s*store|apk|aab|ready\s+to\s+(?:ship|launch))\b/i;
const MOBILE = /\b(?:mobile|android|ios|iphone|cross-platform)\s+(?:app|application)\b|\bapp\s+for\s+(?:android|ios)\b/i;
const OTHER_MOBILE = /\b(?:react\s*native|expo|kotlin|swift(?:ui)?|jetpack\s+compose|ionic|capacitor|xamarin|maui)\b/i;
export const EXPLAINS_BLOCKER = /\b(?:not installed|isn't installed|is not installed|missing|cannot run|can't run|couldn't run|could not run|unable to run|not available)\b/i;

export function releaseIntent(prompt: string): boolean {
    return RELEASE_INTENT.test(prompt);
}

/** Playbooks for a deep build or change task, or none for questions and small work. */
export function choosePlaybooks(prompt: string, tier: Tier, rootFiles: ReadonlySet<string>): Playbook[] {
    if (tier !== 'deep') {
        return [];
    }
    if (DOCUMENTS.request.test(prompt) && DOCUMENT_INTENT.test(prompt) && !BUILD_INTENT.test(prompt)) {
        return [DOCUMENTS];
    }
    const build = BUILD_INTENT.test(prompt) || RELEASE_INTENT.test(prompt);
    if (!build && !CHANGE_INTENT.test(prompt)) {
        return [];
    }
    let matched = PLAYBOOKS.filter((playbook) => playbook.request.test(prompt));
    // ASP.NET renders its own pages; the web playbook's Vite and React advice would pull the wrong way.
    if (matched.includes(DOTNET)) {
        matched = matched.filter((playbook) => playbook !== WEB);
    }
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
        toolchains.length
            ? `1. Preflight: call inspect_environment with ${JSON.stringify(toolchains)}. If one of these is missing, stop and tell the user exactly what to install and where to get it. Optional extras (uv, poetry, conda, a linter) are not a reason to stop: use what is installed. Ask before installing SDKs, running system package managers, or changing PATH or shell profiles.`
            : '1. Preflight: only when the work needs an installed toolchain (a compiler, an SDK, a package manager), call inspect_environment for it; if it is missing, stop and tell the user what to install. Plain HTML, CSS and JavaScript need none: skip this step.',
        '2. Plan with todo_write: a few concrete steps that end with the checks below. Send the plan in the same reply as your first actions, never as a reply of its own.',
        '3. Work in few, full replies: every reply resends the whole conversation, so put all the tool calls that do not depend on each other in one reply. Write each file complete in a single write_file, and create the files of a small project together. After each milestone, run the matching gate and fix what it reports.',
        '4. Use only real packages, APIs and URLs you have checked. Never fake a feature with a placeholder.',
        '5. Do not finish until every required gate has passed, or you have clearly explained why one cannot run here. A gate applies only when the project has the build or test it names: do not add a build system or a test runner just to pass one.',
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

/** Whether a playbook's gates apply, given the file names found near what the task changed. */
export function gatesApply(playbook: Playbook, nearby: ReadonlySet<string> | undefined): boolean {
    if (!nearby || !playbook.manifests?.length) {
        return true;
    }
    return playbook.manifests.some((name) => (name.startsWith('*.') ? [...nearby].some((file) => file.endsWith(name.slice(1))) : nearby.has(name)));
}

/**
 * How each gate stands. `nearby` is the names of the files beside what the
 * task changed; a playbook whose manifests are all missing there has nothing
 * to build or test, so none of its gates is required.
 */
export function evaluateGates(playbooks: Playbook[], runs: CommandRun[], release: boolean, nearby?: ReadonlySet<string>): GateResult[] {
    const prefix = playbooks.length > 1;
    return playbooks.flatMap((playbook) =>
        playbook.gates.map((gate) => {
            const run = [...runs].reverse().find((r) => !r.background && gate.matches.test(r.command));
            return {
                label: prefix ? `${playbook.name}: ${gate.label}` : gate.label,
                command: gate.command,
                required: isRequired(gate, release) && gatesApply(playbook, nearby),
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
