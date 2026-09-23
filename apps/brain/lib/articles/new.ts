/**
 * Pages written for the searches Google autocomplete shows people making
 * (September 2026): "free ai coding agent for vs code", "free claude code
 * alternative", "free cursor alternative", "chat with github repo", "free api
 * key for coding", "…for students", "impact analysis of code change".
 * Every claim about FreeAgentCoder is true of the shipped product; claims about
 * other tools are kept general and dated, since pricing changes.
 */
import type { Article, Block } from './existing';

const p = (text: string): Block => ({ type: 'p', text });
const h2 = (text: string): Block => ({ type: 'h2', text });
const ul = (items: string[]): Block => ({ type: 'ul', items });
const ol = (items: string[]): Block => ({ type: 'ol', items });
const table = (headers: string[], rows: string[][]): Block => ({ type: 'table', headers, rows });
const callout = (text: string): Block => ({ type: 'callout', text });

const NOT_AFFILIATED = callout('FreeAgentCoder is not affiliated with, endorsed by, or a product of any other company named on this page. Details about other tools reflect their public information as of September 2026 and may change.');

export const FREE_AGENT_VSCODE: Article = {
    slug: 'free-ai-coding-agent-vscode',
    title: 'Free AI Coding Agent for VS Code (2026)',
    description:
        'FreeAgentCoder is a free, open-source AI coding agent for VS Code. It plans, edits, runs your tests and fixes failures on free Gemini, Groq and Cerebras keys.',
    h1: 'A free AI coding agent for VS Code',
    dek: 'Not autocomplete: an agent that plans a task, edits files across your project, runs your build and tests, and keeps going until they pass. Free, on free API keys.',
    updated: '2026-09-22',
    blocks: [
        p('Most "free" AI coding tools are free to install and then paid per use. FreeAgentCoder is built the other way around: it runs on the free tiers that AI providers give away — Google Gemini, Groq, Cerebras, Mistral and OpenRouter — and moves your work from one key to the next when a provider hits its limit, so a task keeps going instead of stopping.'),
        h2('What the agent does'),
        ol([
            'Reads your project and makes a plan you can see, step by step.',
            'Edits files across the codebase, with a diff for every change and one-click undo.',
            "Runs your project's own type check, lint, tests and build — the commands your project actually uses.",
            'Fixes what fails and checks again. A complex task cannot finish until a check passes after its last edit.',
        ]),
        h2('Why it stays free'),
        ul([
            'Your keys, your usage: free keys from several providers, each with its own free limits.',
            'Automatic failover: when one key is rate-limited or out of daily quota, the next takes over mid-task.',
            'A warning before a task starts if today’s remaining limits look too small for it, with a link to add a key.',
            'No FreeAgentCoder account, subscription or server. Keys are encrypted in VS Code Secret Storage on your machine.',
        ]),
        h2('How it compares'),
        table(
            ['', 'Typical paid assistant', 'Typical BYOK extension', 'FreeAgentCoder'],
            [
                ['Cost', 'Monthly plan', 'Free extension, you pay the model provider', 'Free, on free provider tiers'],
                ['Keys', 'Vendor account', 'One key you configure', 'Several free keys, with automatic failover'],
                ['Verification', 'Varies', 'Up to you', "Must pass your project's own checks before finishing"],
                ['Limits', 'Set by the plan', 'Set by your spend', 'Forecast before each task, warned early'],
            ],
        ),
        p('It works in the VS Code you already use — no new editor — and opens in the right side bar next to your code.'),
    ],
    faq: [
        { q: 'Is FreeAgentCoder really free?', a: 'Yes. The extension is free and MIT licensed with no subscription, and it runs on the free tiers of AI providers. You can add a paid OpenAI or Anthropic key if you want to, but you never have to.' },
        { q: 'Is it unlimited?', a: "No provider's free tier is unlimited, and we won't pretend otherwise. FreeAgentCoder adds no caps of its own; adding free keys from several providers raises your daily ceiling, and it tells you before a task would run out." },
        { q: 'Does it work offline or with local models?', a: 'It uses hosted models through your API keys. The underlying engine also supports local Ollama models.' },
        { q: 'Where do my API keys go?', a: 'Nowhere but the provider each key belongs to. They are encrypted in VS Code Secret Storage on your computer and never sent to FreeAgentCoder.' },
    ],
};

export const CLAUDE_CODE_ALTERNATIVE: Article = {
    slug: 'free-claude-code-alternative',
    title: 'Free Claude Code Alternative for VS Code',
    description:
        'Looking for a free Claude Code alternative? FreeAgentCoder is an open-source agent for VS Code that plans, edits and verifies code on free API keys. No plan needed.',
    h1: 'A free, open-source Claude Code alternative',
    dek: 'Claude Code is an excellent agent that runs on a paid Claude plan or API usage. FreeAgentCoder gives you the same agentic loop in VS Code on free API keys.',
    updated: '2026-09-22',
    blocks: [
        p('Claude Code popularised the idea of an agent that works through a task the way a developer would: read the code, plan, edit, run the tests, fix, repeat. That loop is what makes agents useful. FreeAgentCoder brings the same loop to a VS Code extension, and runs it on free API keys from Gemini, Groq, Cerebras, Mistral and OpenRouter.'),
        h2('What carries over'),
        ul([
            'An explicit plan you can follow while it works.',
            'Multi-file edits with diffs and undo.',
            'Running your real build and tests, and fixing what fails.',
            'Permission modes: ask before every edit, edit freely but ask before commands, or run everything except risky commands.',
        ]),
        h2('What is different'),
        table(
            ['', 'Claude Code', 'FreeAgentCoder'],
            [
                ['Cost', 'A paid Claude plan or pay-as-you-go API usage', 'Free, on free provider tiers'],
                ['Models', "Anthropic's Claude models", 'Gemini, Groq, Cerebras, Mistral, OpenRouter — plus Claude or OpenAI if you add a paid key'],
                ['Where it runs', 'Terminal, with IDE integrations', 'A VS Code extension in the side bar'],
                ['Source', 'Proprietary', 'Open source, MIT'],
            ],
        ),
        p("Be honest with yourself about the trade-off: Claude's strongest models are among the best coding models available, and free-tier models are not the same. FreeAgentCoder closes much of the gap with verification — work is checked against your project's own tests and build before it counts as done — but it is not a like-for-like replacement for the top paid models."),
        NOT_AFFILIATED,
    ],
    faq: [
        { q: 'Is there a completely free alternative to Claude Code?', a: "Yes. FreeAgentCoder is free and open source, and runs on free API keys, so there is nothing to pay. Its limits are the free tiers' daily limits, which grow as you add keys from more providers." },
        { q: 'Can I still use Claude models with it?', a: 'Yes. Add an Anthropic API key and FreeAgentCoder can use Claude models, with your free keys as a fallback.' },
        { q: 'Does it work in VS Code?', a: 'Yes — it is a VS Code extension and opens in the right side bar.' },
    ],
};

export const CURSOR_ALTERNATIVE: Article = {
    slug: 'free-cursor-alternative',
    title: 'Free Cursor Alternative That Works in VS Code',
    description:
        'Want a free Cursor alternative without switching editors? FreeAgentCoder adds a free AI coding agent to the VS Code you already use, on free Gemini and Groq keys.',
    h1: 'A free Cursor alternative — without leaving VS Code',
    dek: 'Cursor is a separate editor with a limited free plan. FreeAgentCoder is an extension: keep VS Code, your settings and your extensions, and add a free agent.',
    updated: '2026-09-22',
    blocks: [
        p("Cursor is built from VS Code and adds its own AI features; its free plan is limited and heavier use needs a paid plan. If what you want is an AI agent that works through tasks in your project, you don't have to change editors to get one."),
        h2('What you keep'),
        ul(['Your VS Code, your theme, keybindings and extensions.', 'Your own API keys, stored encrypted on your machine.', 'Full control: every edit is shown as a diff, and can be undone.']),
        h2('What you get'),
        ul([
            'An agent that plans, edits multiple files, runs your tests and fixes failures.',
            'Free operation on free provider tiers, with automatic failover between keys.',
            'Screenshots and PDFs as input — paste a design or an error and it works from it.',
            "A check that your project's own build or tests pass before a complex task finishes.",
        ]),
        table(
            ['', 'Cursor', 'FreeAgentCoder'],
            [
                ['Type', 'A separate editor', 'An extension for VS Code'],
                ['Free use', 'A limited free plan', 'Free, on free provider tiers'],
                ['Inline autocomplete', 'Yes', 'No — it is an agent, not autocomplete'],
            ],
        ),
        NOT_AFFILIATED,
    ],
    faq: [
        { q: 'Is there a free Cursor alternative for VS Code?', a: 'FreeAgentCoder is one: a free, open-source AI coding agent that runs inside VS Code on free API keys.' },
        { q: 'Does it do tab autocomplete like Cursor?', a: 'No. FreeAgentCoder is an agent for tasks — building features, fixing bugs, explaining code — rather than inline completion.' },
        { q: 'Do I need a credit card?', a: 'No. Gemini, Groq and Cerebras give free API keys without a card.' },
    ],
};

export const CHAT_WITH_REPO: Article = {
    slug: 'chat-with-github-repo',
    title: 'Chat With Any GitHub Repo — Free AI Repo Analyzer',
    description:
        'Paste any public GitHub repo and understand it in seconds: stack, architecture, answers with real file references, code search and what a change would break.',
    h1: 'Chat with any GitHub repository',
    dek: 'Project Brain reads a repository in a few seconds and answers questions with the files and lines that prove it — then shows what a change would touch.',
    updated: '2026-09-22',
    blocks: [
        p('Most "chat with your repo" tools send your question and a pile of code to a model and hope. Project Brain starts from a structured analysis of the repository — its stack, its layers, its import graph — and every file path in an answer is checked against the files that actually exist. A path the model invents is flagged, not trusted.'),
        h2('What you get from one link'),
        ul([
            'The stack, database, testing and package manager — each with the file it was read from.',
            'An architecture view built only from layers the repository really has.',
            'Answers that cite files and line ranges, verified against the repository.',
            'Ranked code search that puts implementation above tests, docs and examples.',
            'Impact analysis: which files a change touches directly and through imports, and a risk level.',
        ]),
        h2('Private by design'),
        ul([
            'Read-only: repository code is never executed.',
            'Committed .env files and anything credential-shaped are never sent to a model.',
            'Repositories are held in memory for an hour, not stored.',
        ]),
        h2('From understanding to a change'),
        p('Describe a change and Project Brain drafts a step-by-step plan from the real files. One click opens it in the free FreeAgentCoder agent in VS Code, which makes the change on your own copy and checks it against your tests.'),
    ],
    faq: [
        { q: 'Is it free?', a: 'Yes. Search, architecture and impact analysis are free with no key. Asking questions includes a few free questions a day, then uses your own free API key.' },
        { q: 'Does it work with private repositories?', a: 'Public repositories today. Private repositories with GitHub sign-in are next.' },
        { q: 'Does it change my repository?', a: 'Never. Project Brain only reads. Changes are made by the agent in VS Code, on your own copy, and nothing is pushed without you.' },
    ],
};

export const FREE_API_KEYS: Article = {
    slug: 'free-ai-api-keys-for-coding',
    title: 'Free AI API Keys for Coding: Gemini, Groq, Cerebras',
    description:
        'Where to get free AI API keys for coding — Google Gemini, Groq, Cerebras, Mistral and OpenRouter — what each is good for, and the one-key-per-account rule.',
    h1: 'Free AI API keys for coding',
    dek: 'Five providers give free API keys you can use for coding, most without a credit card. Here is where to get each, what it is best at, and how to combine them.',
    updated: '2026-09-22',
    blocks: [
        h2('Where to get them'),
        table(
            ['Provider', 'Get a key', 'Best for'],
            [
                ['Google Gemini', 'aistudio.google.com/apikey', 'Large codebases — reads a lot of code at once'],
                ['Groq', 'console.groq.com/keys', 'Very fast answers and small edits'],
                ['Cerebras', 'cloud.cerebras.ai', 'Fast, with a generous free tier'],
                ['OpenRouter', 'openrouter.ai/keys', 'Free models from several makers behind one key'],
                ['Mistral', 'console.mistral.ai/api-keys', 'A solid all-rounder'],
            ],
        ),
        h2('One key per account'),
        callout("A second key from the same account shares that account's limits, so it adds nothing. To get more free capacity, add a key from a different provider. Provider terms don't allow making extra accounts to get around limits."),
        h2('How to combine them'),
        ul([
            'Start with Gemini: it handles the largest amount of code at once.',
            'Add Groq and Cerebras for speed on small tasks.',
            'Add OpenRouter and Mistral for extra headroom.',
            'In FreeAgentCoder, work moves between your keys automatically when one hits its limit.',
        ]),
        h2('Keep them safe'),
        ul(['Never commit a key to a repository or paste it into a public issue.', 'In FreeAgentCoder, keys are encrypted in VS Code Secret Storage on your machine.', 'If a key leaks, delete it in the provider console and create a new one.']),
    ],
    faq: [
        { q: 'Is the Gemini API key free?', a: 'Yes. Google AI Studio gives a free API key with daily limits, without a credit card to start.' },
        { q: 'Which free API key is best for coding?', a: 'Gemini for large projects, Groq or Cerebras for speed. Using several together, with automatic failover, beats any single one.' },
        { q: 'Are free API keys unlimited?', a: 'No. Each has daily and per-minute limits. Keys from several providers raise the total.' },
    ],
};

export const FOR_STUDENTS: Article = {
    slug: 'free-ai-coding-agent-for-students',
    title: 'Free AI Coding Agent for Students',
    description:
        'A free AI coding agent for students: FreeAgentCoder runs in VS Code on free API keys — no subscription, no credit card — and explains code as it works.',
    h1: 'A free AI coding agent for students',
    dek: 'No subscription and no credit card: free API keys, a free extension, and an agent that shows every step so you learn what it did.',
    updated: '2026-09-22',
    blocks: [
        p('Paid AI coding tools add up quickly on a student budget. FreeAgentCoder is free and open source, and runs on free API keys from Gemini, Groq and Cerebras — none of which need a credit card to start.'),
        h2('Built for learning, not just output'),
        ul([
            'Every step is visible: the plan, each file it reads, each edit as a diff, each command it runs.',
            'Ask it to explain how a project is structured, or why a test fails, in plain words.',
            'Test my project runs your checks and explains each failure with a fix.',
            'Corrections become lessons it follows next time, so it adapts to your course or style.',
        ]),
        h2('Understand an assignment’s codebase first'),
        p('Paste a public GitHub repository into Project Brain to see its structure and ask questions with file references before you start changing it.'),
        callout('Check your course’s rules on AI tools. FreeAgentCoder shows its work so you can learn from it — and so you can tell what you wrote yourself.'),
    ],
    faq: [
        { q: 'Is it free for students?', a: 'It is free for everyone. There is no student plan because there is no paid plan.' },
        { q: 'Do I need a credit card?', a: 'No. Gemini, Groq and Cerebras give free keys without a card.' },
        { q: 'Does it work on a school laptop?', a: 'It runs wherever VS Code runs. The models run in the cloud through your free keys, so it does not need a powerful computer.' },
    ],
};

export const IMPACT_ANALYSIS: Article = {
    slug: 'code-change-impact-analysis',
    title: 'Code Change Impact Analysis: What Will a Change Break?',
    description:
        'See what a code change would touch before you make it: files that mention it, files that import those, packages involved and a risk level — for any GitHub repo.',
    h1: 'Impact analysis for code changes',
    dek: '"What happens if I replace the database?" Project Brain traces a change through the code and the import graph, and tells you what is detected, inferred or estimated.',
    updated: '2026-09-22',
    blocks: [
        p('Before a large change — swapping a database, renaming a field, upgrading a framework — the question that matters is what else it touches. Project Brain answers it from the repository itself, in about a second, without running any code.'),
        h2('Three levels of certainty, kept apart'),
        table(
            ['', 'What it means', 'Label'],
            [
                ['Directly affected', 'Files that mention the thing being changed', 'Detected'],
                ['Through imports', 'Files that import an affected file, up to three steps away', 'Inferred'],
                ['Total and risk', 'How many files, how many kinds of code, whether it reaches both data and API', 'Estimated'],
            ],
        ),
        h2('Then a plan'),
        ol([
            'Confirm the scope against the files that mention the change.',
            'Change the data models first, so everything that depends on them fails loudly.',
            'Update services, then API routes, then UI components.',
            'Update and extend the tests, then run every check.',
        ]),
        p('One click hands the plan to the FreeAgentCoder agent in VS Code, which makes the change on your copy and verifies it against your own tests and build.'),
    ],
    faq: [
        { q: 'How accurate is it?', a: 'Direct hits are exact matches in the code. Files reached through imports come from an import graph that handles JavaScript, TypeScript, Python and Go, including monorepos. Totals and risk are estimates and labelled as such.' },
        { q: 'Does it need an AI key?', a: 'No. Impact analysis runs entirely on the analysis, with no model call.' },
        { q: 'Which languages does it support?', a: 'Import tracing covers JavaScript, TypeScript, Python and Go. Text matching works for any language.' },
    ],
};

export const NEW_ARTICLES = [FREE_AGENT_VSCODE, CLAUDE_CODE_ALTERNATIVE, CURSOR_ALTERNATIVE, CHAT_WITH_REPO, FREE_API_KEYS, FOR_STUDENTS, IMPACT_ANALYSIS];
