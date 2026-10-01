/**
 * Fyx: everyday tasks done on this machine without an AI model.
 *
 * Zipping a folder, git chores, installing packages, running a script: these
 * have one right answer, so asking a model to work them out wastes minutes and
 * thousands of tokens. Fyx recognises them, plans the exact commands for this
 * platform and shell, and hands them to the same agent loop, so they show up as
 * ordinary command cards, ask the same permissions and can be stopped the same
 * way. Anything it is not sure about goes to the model as before.
 *
 * Pure: everything it needs about the project comes in through `FyxContext`.
 */

export type ShellKind = 'bash' | 'powershell' | 'sh' | 'cmd';

export interface FyxContext {
    platform: NodeJS.Platform;
    shell: ShellKind;
    /** Folder names at the project root. */
    dirs: string[];
    /** File names at the project root. */
    files: string[];
    packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun';
    /** Script names from the root package.json. */
    scripts: string[];
    git: boolean;
    /** Projects in folders one level down, for a repository whose app is not at the root. */
    subprojects?: { dir: string; packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun'; scripts: string[] }[];
}

export interface FyxStep {
    command: string;
    /** Long-running: dev servers and watchers. */
    background?: boolean;
    timeout?: number;
}

export interface FyxPlan {
    /** A short name for the kind of task, for counts and the panel. */
    kind: string;
    /** One line shown before the commands run. */
    intro: string;
    steps: FyxStep[];
    /** What to say when every step succeeded. */
    done: string;
}

/** Requests that ask for judgement, code or explanation go to the model, even if they mention a chore. */
const NEEDS_A_MODEL =
    /\b(fix|bug|error|why|explain|how (do|does|can|to)|implement|refactor|design|component|page|function|class|test cases?|write (a|an|the|some)|review|optimi[sz]e|improve|debug|migrate|convert .* to|translate|summari[sz]e|then|after that|and also)\b/i;
const MAX_WORDS = 28;

/** Safe to put inside double quotes in bash, PowerShell and cmd. */
const SAFE_NAME = /^[\w.@+\-/ ]{1,120}$/;
const q = (value: string) => `"${value}"`;

function words(prompt: string): number {
    return prompt.trim().split(/\s+/).length;
}

/** Finds a folder the request names: exact, then without a trailing "s", then case-insensitive. */
function findDir(text: string, ctx: FyxContext): string | undefined {
    const lower = text.toLowerCase();
    // Dependency and tool folders are named to be left out or kept, not zipped on their own.
    const byLength = ctx.dirs.filter((d) => !HEAVY.includes(d)).sort((a, b) => b.length - a.length);
    for (const dir of byLength) {
        const name = dir.toLowerCase();
        const pattern = new RegExp(`(^|[\\s"'\`/])${escape(name)}s?([\\s"'\`/.,]|$)`);
        if (pattern.test(lower)) {return dir;}
    }
    return undefined;
}

function escape(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A name the request gives its output: "named X", "called X", "as X", "into X.zip". */
function namedOutput(text: string): string | undefined {
    const pattern = /\b(?:named|called|as|into|to)\s+["'`]?([\w.@+\-]+?)(?:\.zip)?["'`]?(?=\s+(?:file|archive|zip|in|inside)\b|[\s.,!]*$)/gi;
    for (const match of text.matchAll(pattern)) {
        const name = match[1];
        if (name && !/^(a|an|the|zip|file|archive|this|current|folder|here)$/i.test(name)) {return name;}
    }
    return undefined;
}

const HEAVY = ['node_modules', '.git', '.venv', 'venv', '__pycache__', '.next', '.turbo'];

function zipPlan(text: string, ctx: FyxContext): FyxPlan | undefined {
    if (!/\b(zip|compress|archive)\b/i.test(text) || /\b(unzip|extract|decompress)\b/i.test(text)) {return undefined;}
    const whole = /\b(this|the|current|whole|entire)\s+(project|folder|directory|repo|workspace)\b|\beverything\b/i.test(text);
    const dir = findDir(text, ctx) ?? (whole ? '.' : undefined);
    if (!dir || !SAFE_NAME.test(dir)) {return undefined;}
    const base = namedOutput(text) ?? (dir === '.' ? 'project' : dir);
    if (!SAFE_NAME.test(base)) {return undefined;}
    const out = `${base}.zip`;
    const keepAll = /\binclud(e|ing)\b.*\b(node_modules|everything|all files|\.git)\b|\bwith node_modules\b/i.test(text);
    const skip = keepAll ? [] : HEAVY;
    const skipped = keepAll ? '' : ' Left out node_modules, .git and other rebuildable folders; say "include node_modules" to keep them.';
    const what = dir === '.' ? 'the project' : dir;
    let command: string;
    if (ctx.platform === 'win32' || ctx.platform === 'darwin') {
        // bsdtar writes real zip files: built into Windows 10+ and macOS. On Windows, name it in full so Git Bash's GNU tar is not used.
        const tar = ctx.platform === 'win32' ? 'C:/Windows/System32/tar.exe' : 'tar';
        const excludes = [...skip, out].map((name) => `--exclude=${q(name)}`).join(' ');
        command = `${tar} -a -c -f ${q(out)} ${excludes} ${q(dir)}`;
    } else {
        const excludes = skip.length ? ` -x ${skip.map((name) => q(`*/${name}/*`)).join(' ')}` : '';
        command = `zip -r -q ${q(out)} ${q(dir)}${excludes} -x ${q(out)}`;
    }
    return {
        kind: 'zip',
        intro: `Zipping ${what} into ${out}.`,
        steps: [{ command, timeout: 600 }],
        done: `Zipped ${what} into ${out}.${skipped}`,
    };
}

function unzipPlan(text: string, ctx: FyxContext): FyxPlan | undefined {
    if (!/\b(unzip|extract|decompress)\b/i.test(text)) {return undefined;}
    const file = ctx.files.find((f) => /\.zip$/i.test(f) && text.toLowerCase().includes(f.toLowerCase().replace(/\.zip$/, '')));
    if (!file || !SAFE_NAME.test(file)) {return undefined;}
    const target = /\b(?:into|to|in)\s+(?:a\s+folder\s+(?:named|called)\s+)?["'`]?([\w.@+\-]+)["'`]?\s*(?:folder)?\s*$/i.exec(text)?.[1];
    const dest = target && SAFE_NAME.test(target) && target.toLowerCase() !== file.toLowerCase() ? target : file.replace(/\.zip$/i, '');
    const mkdir = `node -e ${q(`require('fs').mkdirSync('${dest}',{recursive:true})`)}`;
    const command =
        ctx.platform === 'win32' || ctx.platform === 'darwin'
            ? `${ctx.platform === 'win32' ? 'C:/Windows/System32/tar.exe' : 'tar'} -x -f ${q(file)} -C ${q(dest)}`
            : `unzip -q -o ${q(file)} -d ${q(dest)}`;
    return { kind: 'unzip', intro: `Extracting ${file} into ${dest}.`, steps: [{ command: mkdir }, { command, timeout: 600 }], done: `Extracted ${file} into ${dest}.` };
}

function quoted(text: string): string | undefined {
    return /["“'`]([^"”'`]{1,200})["”'`]/.exec(text)?.[1]?.trim();
}

/** A commit message the request spells out: in quotes, or after "message", "saying" or a colon. */
function commitMessage(text: string): string | undefined {
    const message = quoted(text) ?? /\b(?:message|saying|msg)\s*:?\s+(.{2,200})$/i.exec(text)?.[1] ?? /:\s*(.{2,200})$/.exec(text)?.[1];
    const clean = message?.trim().replace(/[.]+$/, '');
    return clean && !/["`$\\]/.test(clean) ? clean : undefined;
}

const BRANCH = /^[\w.\-/]{1,100}$/;

function gitPlan(text: string, ctx: FyxContext): FyxPlan | undefined {
    const t = text.toLowerCase();
    const clone = /\b(clone|fork)\b.*?(https?:\/\/github\.com\/[\w.\-]+\/[\w.\-]+?)(?:\.git)?(?:\s|$)/i.exec(text);
    if (clone) {
        const url = clone[2]!;
        if (/\bfork\b/i.test(text)) {
            return {
                kind: 'git-fork',
                intro: `Forking ${url} to your GitHub account and cloning your fork.`,
                steps: [{ command: `gh repo fork ${q(url)} --clone`, timeout: 300 }],
                done: `Forked ${url} and cloned your fork here. This uses the GitHub CLI (gh); if it is not installed, get it from cli.github.com and sign in with "gh auth login".`,
            };
        }
        return { kind: 'git-clone', intro: `Cloning ${url}.`, steps: [{ command: `git clone ${q(url)}`, timeout: 600 }], done: `Cloned ${url}.` };
    }
    if (!/\bgit\b|\bcommit\b|\bpush\b|\bpull\b|\bbranch(es)?\b|\bstash\b|\bcheckout\b|\bwhat('s| has)? changed\b|\bstatus\b/.test(t)) {return undefined;}
    if (!ctx.git && !/\bgit init\b|\binit(ialise|ialize)? (a )?(git|repo)/.test(t)) {
        return undefined;
    }
    if (/\bgit init\b|\binit(ialise|ialize)? (a )?(git|repo)/.test(t)) {
        return { kind: 'git-init', intro: 'Starting a git repository here.', steps: [{ command: 'git init' }], done: 'Started a git repository in this folder.' };
    }
    if (/\bcommit\b/.test(t)) {
        const message = commitMessage(text);
        if (!message) {return undefined;} // Writing the message needs the model.
        const steps: FyxStep[] = [{ command: 'git add -A' }, { command: `git commit -m ${q(message)}` }];
        const push = /\bpush\b/.test(t);
        if (push) {steps.push({ command: 'git push', timeout: 300 });}
        return {
            kind: push ? 'git-commit-push' : 'git-commit',
            intro: push ? 'Committing every change and pushing it.' : 'Committing every change.',
            steps,
            done: push ? `Committed every change as "${message}" and pushed it.` : `Committed every change as "${message}".`,
        };
    }
    if (/\bpush\b/.test(t) && !/\bforce\b/.test(t)) {return { kind: 'git-push', intro: 'Pushing this branch.', steps: [{ command: 'git push', timeout: 300 }], done: 'Pushed this branch.' };}
    if (/\bpull\b/.test(t)) {return { kind: 'git-pull', intro: 'Pulling the latest changes.', steps: [{ command: 'git pull', timeout: 300 }], done: 'Pulled the latest changes.' };}
    const branchName = /\b(?:branch|checkout|switch(?: to)?)\s+(?:called\s+|named\s+)?["'`]?([\w.\-/]+)["'`]?\s*$/i.exec(text)?.[1];
    if (/\b(new|create|make)\b.*\bbranch\b/.test(t) && branchName && BRANCH.test(branchName)) {
        return { kind: 'git-branch', intro: `Creating the branch ${branchName}.`, steps: [{ command: `git switch -c ${q(branchName)}` }], done: `Created and switched to ${branchName}.` };
    }
    if (/\b(switch|checkout|change|go)\b.*\bbranch\b|\bswitch to\b|\bcheckout\b/.test(t) && branchName && BRANCH.test(branchName) && !/^(branch|the|a)$/.test(branchName)) {
        return { kind: 'git-switch', intro: `Switching to ${branchName}.`, steps: [{ command: `git switch ${q(branchName)}` }], done: `Switched to ${branchName}.` };
    }
    if (/\b(list|show|which|what)\b.*\bbranch(es)?\b/.test(t)) {return { kind: 'git-branches', intro: 'Listing branches.', steps: [{ command: 'git branch -a' }], done: 'Those are the branches, with the current one starred.' };}
    if (/\bstash\b/.test(t)) {
        const pop = /\b(pop|apply|restore|bring back|unstash)\b/.test(t);
        return pop
            ? { kind: 'git-stash-pop', intro: 'Restoring the last stash.', steps: [{ command: 'git stash pop' }], done: 'Restored the last stash.' }
            : { kind: 'git-stash', intro: 'Stashing the current changes.', steps: [{ command: 'git stash push -u' }], done: 'Stashed the current changes, including new files. Say "pop the stash" to bring them back.' };
    }
    if (/\b(status|what changed|what('s| has) changed|changes)\b/.test(t)) {return { kind: 'git-status', intro: 'Checking what changed.', steps: [{ command: 'git status --short --branch' }], done: 'That is what changed since the last commit.' };}
    if (/\b(log|history|last|recent)\b.*\bcommits?\b|\bgit log\b/.test(t)) {return { kind: 'git-log', intro: 'Showing recent commits.', steps: [{ command: 'git log --oneline -n 15' }], done: 'Those are the 15 most recent commits.' };}
    return undefined;
}

type PackageManager = NonNullable<FyxContext['packageManager']>;

interface Project {
    /** "." for the root, otherwise the folder it lives in. */
    dir: string;
    pm: PackageManager;
    scripts: string[];
}

/** Which project a request means: one it names, else the root one, else the only one in a subfolder. */
function projectFor(text: string, ctx: FyxContext): Project | undefined {
    const subs = (ctx.subprojects ?? []).map((p) => ({ dir: p.dir, pm: p.packageManager, scripts: p.scripts }));
    const named = subs.find((p) => new RegExp(`(^|[\\s"'\`/])${escape(p.dir.toLowerCase())}([\\s"'\`/.,]|$)`).test(text.toLowerCase()));
    if (named) {return named;}
    if (ctx.packageManager) {return { dir: '.', pm: ctx.packageManager, scripts: ctx.scripts };}
    return subs.length === 1 ? subs[0] : undefined;
}

/** The command for `args` in a project, run from the root: every package manager can point at a folder, in any shell. */
function inProject(project: Project, args: string): string {
    if (project.dir === '.') {return `${project.pm} ${args}`;}
    const at = q(project.dir);
    switch (project.pm) {
        case 'npm':
            return `npm --prefix ${at} ${args}`;
        case 'pnpm':
            return `pnpm --dir ${at} ${args}`;
        case 'yarn':
            return `yarn --cwd ${at} ${args}`;
        case 'bun':
            return `bun --cwd ${at} ${args}`;
    }
}

function packagePlan(text: string, ctx: FyxContext): FyxPlan | undefined {
    const project = projectFor(text, ctx);
    if (!project) {return undefined;}
    const { pm } = project;
    const where = project.dir === '.' ? '' : ` in ${project.dir}`;
    const t = text.toLowerCase();
    const add = pm === 'npm' ? 'install' : 'add';
    const remove = pm === 'npm' ? 'uninstall' : 'remove';
    if (/\b(install|add)\b/.test(t) && /\b(dependencies|deps|packages|node[_ ]modules|requirements)\b/.test(t) && !/\b(add|install)\s+(the\s+)?(package|library|dependency)\s+\w/.test(t)) {
        return { kind: 'install', intro: `Installing dependencies${where} with ${pm}.`, steps: [{ command: inProject(project, 'install'), timeout: 600 }], done: `Installed the dependencies${where} with ${pm}.` };
    }
    const devClause = /\s+(?:as\s+(?:a\s+)?dev(?:elopment)?\s+dependenc(?:y|ies)|to\s+(?:the\s+)?dev\s+dependencies)\s*$/i;
    const devAsked = devClause.test(text);
    const named = /\b(install|add|uninstall|remove)\s+(?:the\s+)?(?:(?:package|library|dependency|dev dependency)\s+)?((?:@?[\w.\-]+\/)?[\w.\-]+(?:@[\w.\-^~]+)?(?:\s*,?\s*(?:and\s+)?(?:@?[\w.\-]+\/)?[\w.\-]+(?:@[\w.\-^~]+)?)*)\s*(?:as a dev(?:elopment)? dependency|to (?:the )?(?:project|dev dependencies))?\s*$/i.exec(
        text.trim().replace(devClause, ''),
    );
    if (named) {
        const removing = /^(uninstall|remove)$/i.test(named[1]!);
        const names = named[2]!.split(/\s*,\s*|\s+and\s+|\s+/).filter((n) => n && !/^(the|package|packages|library|dependency)$/i.test(n));
        // Package names only: an ordinary word means this is a sentence about the code, for the model.
        const ordinary = /^(a|an|some|new|my|our|this|that|it|to|for|with|in|on|feature|page|button|login|logout|form|support|function|component|api|route|test|tests|file|files|folder)$/i;
        if (!names.length || names.length > 6 || names.some((n) => ordinary.test(n) || !/^(@?[\w.\-]+\/)?[\w.\-]+(@[\w.\-^~]+)?$/.test(n))) {return undefined;}
        const dev = !removing && devAsked ? (pm === 'npm' ? ' --save-dev' : ' -D') : '';
        const list = names.join(' ');
        return {
            kind: removing ? 'remove-package' : 'add-package',
            intro: `${removing ? 'Removing' : 'Adding'} ${list}${where} with ${pm}.`,
            steps: [{ command: inProject(project, `${removing ? remove : add} ${list}${dev}`), timeout: 600 }],
            done: `${removing ? 'Removed' : 'Added'} ${list}.`,
        };
    }
    const local = /\b(run|start|launch|serve|open|spin up|fire up|boot)\b.*\b(website|site|app|project|server|frontend|front end|backend|back end|locally|local ?host)\b/.test(t);
    const script = /\b(?:run|start|launch|serve)\b\s*(?:the\s+)?(dev|start|build|test|tests|lint|format|preview|typecheck|check)?\b/.exec(t);
    if (script || local) {
        const asked = script?.[1] === 'tests' ? 'test' : script?.[1];
        const wanted = asked ?? (local || /\b(start|launch|serve)\b/.test(t) ? (project.scripts.includes('dev') ? 'dev' : 'start') : undefined);
        if (!wanted || !project.scripts.includes(wanted)) {return undefined;}
        const background = wanted === 'dev' || wanted === 'start' || wanted === 'preview';
        const args = pm === 'npm' ? (wanted === 'test' || wanted === 'start' ? wanted : `run ${wanted}`) : `run ${wanted}`;
        return {
            kind: `run-${wanted}`,
            intro: background ? `Starting ${wanted}${where} in the background.` : `Running ${wanted}${where}.`,
            steps: [{ command: inProject(project, args), background, timeout: background ? undefined : 600 }],
            done: background
                ? `Started ${wanted}${where} in the background. Its local address (for example http://localhost:5173) is in the output above; it keeps running while you work.`
                : `Ran ${wanted}${where}.`,
        };
    }
    return undefined;
}

/** File chores through Node, which behaves the same in every shell. Deleting is left to the model and its safety checks. */
function filePlan(text: string, ctx: FyxContext): FyxPlan | undefined {
    const node = (code: string) => `node -e ${q(code)}`;
    const make = /\b(?:create|make|add)\s+(?:a\s+)?(?:new\s+)?(folder|directory|file)\s+(?:named\s+|called\s+)?["'`]?([\w.\-/@+]+)["'`]?\s*$/i.exec(text.trim());
    if (make) {
        const name = make[2]!;
        if (!SAFE_NAME.test(name) || name.includes('..')) {return undefined;}
        const folder = /folder|directory/i.test(make[1]!);
        return folder
            ? { kind: 'mkdir', intro: `Creating the folder ${name}.`, steps: [{ command: node(`require('fs').mkdirSync('${name}',{recursive:true})`) }], done: `Created the folder ${name}.` }
            : {
                  kind: 'touch',
                  intro: `Creating the file ${name}.`,
                  steps: [{ command: node(`const f=require('fs'),p=require('path');f.mkdirSync(p.dirname('${name}'),{recursive:true});f.writeFileSync('${name}','',{flag:'a'})`) }],
                  done: `Created the empty file ${name}.`,
              };
    }
    const move = /\b(rename|move|copy|duplicate)\s+["'`]?([\w.\-/@+ ]+?)["'`]?\s+(?:to|into|as)\s+["'`]?([\w.\-/@+]+)["'`]?\s*$/i.exec(text.trim());
    if (move) {
        const [, verb, from, to] = move as unknown as [string, string, string, string];
        const known = [...ctx.dirs, ...ctx.files].some((n) => n.toLowerCase() === from.toLowerCase().split('/')[0]);
        if (!known || !SAFE_NAME.test(from) || !SAFE_NAME.test(to) || from.includes('..') || to.includes('..')) {return undefined;}
        const copying = /copy|duplicate/i.test(verb);
        return {
            kind: copying ? 'copy' : 'move',
            intro: `${copying ? 'Copying' : 'Moving'} ${from} to ${to}.`,
            steps: [{ command: node(copying ? `require('fs').cpSync('${from}','${to}',{recursive:true,errorOnExist:true,force:false})` : `require('fs').renameSync('${from}','${to}')`) }],
            done: `${copying ? 'Copied' : 'Moved'} ${from} to ${to}.`,
        };
    }
    return undefined;
}

function infoPlan(text: string, ctx: FyxContext): FyxPlan | undefined {
    const t = text.toLowerCase();
    if (/\b(todo|todos|fixme)\b/.test(t) && /\b(find|list|show|search|where)\b/.test(t) && ctx.git) {
        return { kind: 'todos', intro: 'Finding TODO and FIXME notes.', steps: [{ command: 'git grep -n -I -E "TODO|FIXME"' }], done: 'Those are the TODO and FIXME notes in tracked files.' };
    }
    if (/\b(count|how many)\b.*\blines\b/.test(t)) {
        const script =
            "const f=require('fs'),p=require('path');const skip=new Set(['node_modules','.git','dist','build','.next','.venv','venv','__pycache__']);const by={};let n=0;(function w(d){for(const e of f.readdirSync(d,{withFileTypes:true})){if(skip.has(e.name))continue;const x=p.join(d,e.name);if(e.isDirectory())w(x);else{const ext=p.extname(e.name)||e.name;if(!/^\\.(js|jsx|ts|tsx|mjs|cjs|py|java|kt|go|rs|rb|php|cs|cpp|c|h|swift|dart|vue|svelte|css|scss|html|sql|sh)$/.test(ext))continue;const c=f.readFileSync(x,'utf8').split('\\n').length;by[ext]=(by[ext]||0)+c;n+=c}}})('.');for(const[k,v]of Object.entries(by).sort((a,b)=>b[1]-a[1]))console.log(k.padEnd(8),v);console.log('total   ',n)";
        return { kind: 'count-lines', intro: 'Counting lines of code.', steps: [{ command: `node -e ${q(script)}` }], done: 'Those are the lines of code by language, leaving out dependencies and build output.' };
    }
    if (/\b(biggest|largest|heaviest)\b.*\b(files?|folders?)\b|\b(folder|project|directory)\s+size\b|\bhow big\b/.test(t)) {
        const script =
            "const f=require('fs'),p=require('path');function s(x){const st=f.lstatSync(x);if(!st.isDirectory())return st.size;let t=0;for(const e of f.readdirSync(x))t+=s(p.join(x,e));return t}const r=f.readdirSync('.').map(e=>[e,s(e)]).sort((a,b)=>b[1]-a[1]);for(const[e,b]of r.slice(0,15))console.log((b/1048576).toFixed(1).padStart(9)+' MB  '+e);console.log('total '+(r.reduce((a,x)=>a+x[1],0)/1048576).toFixed(1)+' MB')";
        return { kind: 'sizes', intro: 'Measuring what takes up space.', steps: [{ command: `node -e ${q(script)}`, timeout: 300 }], done: 'Those are the biggest items in this folder.' };
    }
    return undefined;
}

const PLANNERS = [zipPlan, unzipPlan, gitPlan, packagePlan, filePlan, infoPlan];

/** A plan when the request is one Fyx can do on its own, otherwise undefined and the model takes it. */
export function planFyx(prompt: string, ctx: FyxContext): FyxPlan | undefined {
    const text = prompt.trim().replace(/\s+/g, ' ');
    if (!text || words(text) > MAX_WORDS || NEEDS_A_MODEL.test(text) || text.includes('\n')) {return undefined;}
    for (const planner of PLANNERS) {
        const plan = planner(text, ctx);
        if (plan) {return plan;}
    }
    return undefined;
}
