import { describe, expect, it } from 'vitest';
import { planFyx, type FyxContext } from './plan';
import { FyxProvider } from './provider';

const win: FyxContext = {
    platform: 'win32',
    shell: 'bash',
    dirs: ['homes', 'src', 'node_modules'],
    files: ['package.json', 'site.zip'],
    packageManager: 'npm',
    scripts: ['dev', 'build', 'test', 'lint'],
    git: true,
};
const linux: FyxContext = { ...win, platform: 'linux' };

const commands = (prompt: string, ctx = win) => planFyx(prompt, ctx)?.steps.map((s) => s.command);

describe('planFyx: zipping', () => {
    it('zips the folder the request names, under the name it asks for, leaving out rebuildable folders', () => {
        const plan = planFyx('hey make the whole homes folder into zip file named home-zip in this current folder', win);
        expect(plan?.kind).toBe('zip');
        expect(plan?.steps[0]!.command).toBe(
            'C:/Windows/System32/tar.exe -a -c -f "home-zip.zip" --exclude="node_modules" --exclude=".git" --exclude=".venv" --exclude="venv" --exclude="__pycache__" --exclude=".next" --exclude=".turbo" --exclude="home-zip.zip" "homes"',
        );
        expect(plan?.done).toMatch(/Left out node_modules/);
    });

    it('keeps everything when asked to', () => {
        expect(commands('zip homes including node_modules')?.[0]).toBe('C:/Windows/System32/tar.exe -a -c -f "homes.zip" --exclude="homes.zip" "homes"');
    });

    it('uses zip on Linux', () => {
        expect(commands('compress the homes folder', linux)?.[0]).toMatch(/^zip -r -q "homes.zip" "homes" -x "\*\/node_modules\/\*"/);
    });

    it('zips the whole project', () => {
        expect(commands('zip this project')?.[0]).toMatch(/-f "project.zip" .* "\."$/);
    });

    it('does not guess a folder that is not there', () => {
        expect(planFyx('zip the photos folder', win)).toBeUndefined();
    });

    it('extracts an archive into a folder of its name', () => {
        expect(commands('unzip site.zip')).toEqual([`node -e "require('fs').mkdirSync('site',{recursive:true})"`, 'C:/Windows/System32/tar.exe -x -f "site.zip" -C "site"']);
    });
});

describe('planFyx: git', () => {
    it('commits with the message given, and pushes when asked', () => {
        expect(commands('commit everything with message "update the navbar" and push')).toEqual(['git add -A', 'git commit -m "update the navbar"', 'git push']);
    });

    it('leaves writing a commit message to the model', () => {
        expect(planFyx('commit my changes', win)).toBeUndefined();
    });

    it('never force-pushes', () => {
        expect(planFyx('force push to main', win)).toBeUndefined();
    });

    it('pulls, shows status, makes and switches branches', () => {
        expect(commands('git pull')).toEqual(['git pull']);
        expect(commands('what changed?')).toEqual(['git status --short --branch']);
        expect(commands('create a new branch called feature/login')).toEqual(['git switch -c "feature/login"']);
        expect(commands('switch to branch main')).toEqual(['git switch "main"']);
    });

    it('clones and forks GitHub repositories', () => {
        expect(commands('clone https://github.com/expressjs/express')).toEqual(['git clone "https://github.com/expressjs/express"']);
        expect(commands('fork https://github.com/expressjs/express')).toEqual(['gh repo fork "https://github.com/expressjs/express" --clone']);
    });
});

describe('planFyx: packages and scripts', () => {
    it('installs dependencies and adds packages with the project package manager', () => {
        expect(commands('install the dependencies')).toEqual(['npm install']);
        expect(commands('add axios and zod')).toEqual(['npm install axios zod']);
        expect(commands('install vitest as a dev dependency')).toEqual(['npm install vitest --save-dev']);
        expect(commands('add axios', { ...win, packageManager: 'pnpm' })).toEqual(['pnpm add axios']);
    });

    it('runs scripts the project has, dev servers in the background', () => {
        const dev = planFyx('start the dev server', win);
        expect(dev?.steps[0]).toEqual({ command: 'npm run dev', background: true, timeout: undefined });
        expect(commands('run the tests')).toEqual(['npm test']);
        expect(planFyx('run the deploy', win)).toBeUndefined();
    });
});

describe('planFyx: files', () => {
    it('creates folders and files, and moves only what exists', () => {
        expect(commands('create a folder named assets')).toEqual([`node -e "require('fs').mkdirSync('assets',{recursive:true})"`]);
        expect(commands('rename homes to home')).toEqual([`node -e "require('fs').renameSync('homes','home')"`]);
        expect(planFyx('rename ghost to spirit', win)).toBeUndefined();
    });
});

describe('planFyx: leaves real work to the model', () => {
    it.each([
        'fix the bug in the login page',
        'why does the build fail?',
        'add a dark mode toggle to the navbar component',
        'explain how git push works',
        'zip the homes folder and then deploy it to vercel with a custom domain and analytics please and thank you very much indeed',
        'refactor the install script',
        'add a login feature',
        'add support for dark mode',
        'install a test for the login form',
    ])('%s', (prompt) => {
        expect(planFyx(prompt, win)).toBeUndefined();
    });
});

describe('FyxProvider', () => {
    const plan = planFyx('commit everything with message "x" and push', win)!;

    async function next(messages: unknown[]) {
        const events = [];
        for await (const event of new FyxProvider(plan).stream({ model: 'fyx-1', system: '', tools: [], messages } as never)) {events.push(event);}
        return events.at(-1) as { message: { content: string; toolCalls?: { args: { command: string } }[] } };
    }

    it('plays one step at a time, then reports, using no tokens', async () => {
        const user = { role: 'user', content: 'commit' };
        expect((await next([user])).message.toolCalls?.[0]!.args.command).toBe('git add -A');
        const ok = { role: 'tool', toolCallId: 'a', content: 'Exit code: 0\n' };
        expect((await next([user, { role: 'assistant', content: '' }, ok])).message.toolCalls?.[0]!.args.command).toBe('git commit -m "x"');
        const end = await next([user, { role: 'assistant', content: '' }, ok, { role: 'assistant', content: '' }, ok, { role: 'assistant', content: '' }, ok]);
        expect(end.message.toolCalls).toBeUndefined();
        expect(end.message.content).toMatch(/no tokens/);
    });

    it('stops at a failed step and offers the agent', async () => {
        const end = await next([{ role: 'user', content: 'x' }, { role: 'assistant', content: '' }, { role: 'tool', toolCallId: 'a', content: 'Exit code: 128\nfatal: not a git repository' }]);
        expect(end.message.content).toMatch(/step 1 failed[\s\S]*not a git repository[\s\S]*continue/);
    });
});

describe('planFyx: a project in a subfolder', () => {
    const repo: FyxContext = {
        ...win,
        dirs: ['homes', 'api'],
        files: [],
        packageManager: undefined,
        scripts: [],
        subprojects: [
            { dir: 'homes', packageManager: 'npm', scripts: ['dev', 'build'] },
            { dir: 'api', packageManager: 'pnpm', scripts: ['start'] },
        ],
    };

    it('runs the website locally from the folder it lives in', () => {
        expect(planFyx('can you run the website in localy in the local host in homes', repo)?.steps[0]).toEqual({ command: 'npm --prefix "homes" run dev', background: true, timeout: undefined });
        expect(planFyx('start the api server', repo)?.steps[0]!.command).toBe('pnpm --dir "api" run start');
    });

    it('uses the only subproject when the request names none', () => {
        const one: FyxContext = { ...repo, subprojects: [repo.subprojects![0]!] };
        expect(planFyx('can you run the website locally', one)?.steps[0]!.command).toBe('npm --prefix "homes" run dev');
        expect(planFyx('install dependencies', one)?.steps[0]!.command).toBe('npm --prefix "homes" install');
    });

    it('asks the model when it cannot tell which project', () => {
        expect(planFyx('run the website locally', repo)).toBeUndefined();
    });
});
