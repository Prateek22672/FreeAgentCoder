/**
 * Written for the search "move from lovable to claude code" — the first thing
 * Google suggests for that prefix — and for "export code from lovable", which
 * has a family six suggestions deep.
 *
 * The people making those searches are not beginners looking for a tutorial.
 * They have a working app, they have just watched credits disappear into a
 * bug-fixing loop, and they want out with their code. Two things every existing
 * guide skips are the two things the forums actually ask about: getting the
 * project to run on your own machine, and what happens to the database. Both
 * are answered here.
 */
import type { Article, Block } from './existing';

const p = (text: string): Block => ({ type: 'p', text });
const h2 = (text: string): Block => ({ type: 'h2', text });
const ul = (items: string[]): Block => ({ type: 'ul', items });
const ol = (items: string[]): Block => ({ type: 'ol', items });
const table = (headers: string[], rows: string[][]): Block => ({ type: 'table', headers, rows });
const callout = (text: string): Block => ({ type: 'callout', text });

export const LEAVE_LOVABLE: Article = {
    slug: 'move-off-lovable-keep-building-free',
    title: 'Move Off Lovable: Export Your Code and Keep Building Free',
    description:
        'Get your project out of Lovable or Bolt, run it on your own machine, and keep building with a free AI agent in VS Code — on your own free API keys, with no credits.',
    h1: 'Move off Lovable, and keep building free',
    dek: 'Export the code, get it running locally, keep your data, and carry on with an AI agent that has no credit meter. Including the two steps every other guide leaves out.',
    updated: '2026-09-29',
    blocks: [
        p(
            'Almost nobody leaves these platforms because the AI is bad. They leave because of the arithmetic: you pay per prompt, and the prompts you spend most are the ones fixing what the last prompt broke. One bug becomes a loop, the loop eats a month of credits, and the app is no more finished than it was that morning.',
        ),
        p(
            'The way out is not to start again. It is to take the code you already have — it is yours — put it on your own machine, and change the part that costs money: the model doing the work.',
        ),

        h2('Step 1 — get the code out'),
        p(
            'Lovable and Bolt both connect a project to GitHub. Once connected, the code is pushed to a repository on your account, and that repository is the real thing: a normal project, in normal files, that any editor can open.',
        ),
        ol([
            'In your project settings, connect GitHub and let it create the repository.',
            'Check the repository actually has your code — the `src` folder, a `package.json`, and a commit history.',
            'Clone it: `git clone https://github.com/you/your-project`',
        ]),
        callout(
            'Do this before you run out of credits, not after. The export is free, takes a minute, and gives you a copy you own whatever you decide next. There is no reason to wait for the decision.',
        ),

        h2('Step 2 — get it running on your machine (the part guides skip)'),
        p(
            'This is where most people stop, and no tutorial warns them. On the platform, the preview just appeared. On your machine, the project needs its dependencies installed first — the hundreds of packages the code imports but does not contain.',
        ),
        ol([
            'Install [Node.js](https://nodejs.org) — the LTS version. This is what runs the project.',
            'Open the project folder in [VS Code](https://code.visualstudio.com).',
            'Open the terminal (View → Terminal) and run `npm install`. It will take a few minutes and print a great deal of text. That is normal.',
            'Run `npm run dev`. It prints a web address like `http://localhost:5173`. Open it — that is your app, running on your computer.',
        ]),
        p('Three things go wrong here more than anything else:'),
        ul([
            '**`npm: command not found`** — Node is not installed, or the terminal was open before you installed it. Close the terminal and open a new one.',
            '**A wall of red during `npm install`** — usually warnings, not errors. If it finished and made a `node_modules` folder, it worked.',
            '**The page loads but everything is broken or empty** — your environment variables are missing. Look for a `.env.example` file; the real values are in your platform project settings, and they never leave with the code.',
        ]),

        h2('Step 3 — what happens to your database'),
        p(
            'This is the question the forums ask most and answer least. The honest answer depends on where your data actually lives, and it is worth knowing before you move anything.',
        ),
        table(
            ['If your data is in', 'What moving means'],
            [
                ['Your own Supabase project', 'Nothing to do. Your app connects to it with the same keys from wherever it runs — local, hosted, anywhere.'],
                ['The platform’s built-in database', 'The code comes out; the rows do not, automatically. Export what you can from its dashboard, create your own Supabase project, and point the app at it.'],
                ['A local SQLite file', 'Move it with the project, but do not deploy it that way — most hosts wipe the filesystem on every deploy, and the data goes with it.'],
            ],
        ),
        callout(
            'Check this one thing before you ship anything: open your browser’s network tab and look at what the page sends. If a key that starts with `sk-` or a service-role key appears there, it is public to everyone who visits. Rotate it and move it to the server. Scans of vibe-coded apps keep finding this, and it is the single most expensive mistake in the category.',
        ),

        h2('Step 4 — keep building, without the meter'),
        p(
            'You now have the project running locally and an editor open. What you do not have is the thing that made the platform useful: something that writes the code for you. That is what [FreeAgentCoder](/) is — a free, open-source VS Code extension that plans a change, edits the files, runs your tests and fixes what fails.',
        ),
        p(
            'The difference is where the intelligence comes from. Instead of buying credits, you bring a free API key — Google Gemini, Groq, Mistral and OpenRouter all give one away, no card — and the extension uses it. When one key hits its daily limit, it moves to the next and the task continues.',
        ),
        ol([
            'Install [FreeAgentCoder from the Marketplace](https://marketplace.visualstudio.com/items?itemName=PrateekKoratala.freeagentcoder).',
            'Get a free key — the [two-minute Gemini guide](/free-gemini-api-key-vs-code) is the easiest start — and paste it in.',
            'Describe the change in plain words, the way you did on the platform. It reads the project first, shows you a plan, and every edit comes with a diff and one-click undo.',
        ]),

        h2('You do not have to leave entirely'),
        p(
            'The workflow people report as working best is not a clean break. Keep the platform for what it is genuinely good at — starting something from nothing, fast — and do the long tail of small changes locally, where iterations are free. That is the part that was eating your credits anyway: not the first build, but the two hundred little fixes after it.',
        ),

        h2('What you gain and what you lose'),
        table(
            ['', 'On the platform', 'In VS Code, free'],
            [
                ['Cost per change', 'Credits, including for fixing its own mistakes', 'Free tiers of providers, no card'],
                ['When it breaks', 'Prompt again and pay again', 'Undo the diff, or fix one line yourself'],
                ['Your code', 'Behind an export button', 'On your machine, in git'],
                ['Preview', 'Instant, built in', '`npm run dev` — one command, one time'],
                ['Hand-holding', 'It does everything for you', 'You have an editor and have to open it'],
            ],
        ),
        p(
            'That last row is the real trade and it should be said plainly: this is a step up in difficulty. You will see a terminal. In exchange, nothing meters your work, nothing can raise the price, and the project stays yours.',
        ),
    ],
    faq: [
        {
            q: 'Can I really export my code from Lovable?',
            a: 'Yes. Connecting a project to GitHub pushes the code to a repository on your own account, and from there it is an ordinary project you can clone, edit and host anywhere. The code has always been yours.',
        },
        {
            q: 'Do I need to know how to code?',
            a: 'You need less than you fear and more than nothing. The agent writes the code; you need to be able to open a folder, run two commands once, and read an error message well enough to paste it back. If you have been building on a platform for a while, you are closer to this than you think.',
        },
        {
            q: 'Is it actually free, or free-for-a-while?',
            a: 'The extension is free and open source with no subscription. The models run on providers’ free tiers, which are real but not unlimited — each has a daily cap. Adding keys from two or three providers is what makes a full day of work practical, and the extension warns you before a task would run past what is left.',
        },
        {
            q: 'What happens to my Supabase data?',
            a: 'If it is your own Supabase project, nothing changes — the app connects with the same keys from anywhere. If it is the platform’s built-in database, the rows do not travel with the code; export what the dashboard lets you, create your own project, and repoint the app.',
        },
        {
            q: 'Will my app still deploy?',
            a: 'Yes, and to more places. An exported project is a standard build, so Vercel, Netlify, Cloudflare Pages and the rest all take it directly from your GitHub repository. Set the environment variables in the host, since they do not come with the code.',
        },
        {
            q: 'Can I keep using Lovable as well?',
            a: 'Yes, and many people do. Start projects there, then do the many small changes locally where they cost nothing. The two are not exclusive, and the split matches where each one is actually good.',
        },
    ],
};
