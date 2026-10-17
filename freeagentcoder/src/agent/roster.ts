import { DEEP_ORDER, FAST_ORDER, orderWith, PAID_ORDER, providerLabel, TIER_MODELS } from './catalog';
import { SPECIALISTS } from './specialists';
import { toolsFor } from './toolsets';
import { VISION_MODELS, PDF_READER_MODEL } from './visionRoute';
import type { Tier } from '../shared/protocol';

/**
 * The dedicated "roles" FreeAgentCoder routes work to, built from the same
 * constants the router itself uses (model orders, tool sets, specialists), so
 * the admin's Models page can never describe something the extension does not
 * do. A test regenerates apps/brain/lib/roster.json from this and fails when
 * the committed copy is out of date.
 */

export interface ChainLink {
    provider: string;
    label: string;
    models: string[];
}

export interface Role {
    id: string;
    title: string;
    /** What it is: a model chain, no model at all, or a reader. */
    kind: 'models' | 'no-model' | 'reader';
    purpose: string;
    /** The kinds of request that land here. */
    handles: string[];
    /** The outcome kinds the extension reports for this role, to join live results. */
    outcomeKinds: string[];
    chain: ChainLink[];
    chainNote: string;
    effort: { reasoning: 'None' | 'Low' | 'Provider default' | 'High on repeated errors'; level: 0 | 1 | 2 | 3; steps: string; note: string };
    tools: { count: number | 'all'; names: string[]; note: string };
    context: string[];
    approach: string[];
    checks: string[];
    tokens: { typical: string; note: string };
    strengths: string[];
    weaknesses: string[];
    improvements: string[];
}

const link = (provider: string, tier: Tier | 'vision', models?: string[]): ChainLink => ({
    provider,
    label: providerLabel(provider),
    models: models ?? TIER_MODELS[provider]?.[tier as Tier] ?? [],
});

function chain(order: string[], tier: Tier): ChainLink[] {
    return order.filter((p) => TIER_MODELS[p]).map((p) => link(p, tier));
}

const specialist = (id: string) => SPECIALISTS.find((s) => s.id === id)!;
const ALL = toolsFor({ tier: 'deep' }) ?? [];
const BUILD = toolsFor({ tier: 'deep', newBuild: true }) ?? [];
const QUICK = toolsFor({ tier: 'fast' }) ?? [];
const READ = toolsFor({ tier: 'fast', explain: true }) ?? [];
const DOCS = toolsFor({ tier: 'deep', newBuild: true, documents: true }) ?? [];

export function buildRoster(): Role[] {
    const fast = chain(FAST_ORDER, 'fast');
    const deep = chain(DEEP_ORDER, 'deep');
    const paid = PAID_ORDER.map((p) => link(p, 'deep'));
    const paidNote = 'Your own Claude or OpenAI key is only used first when no free key is active; otherwise it waits at the end of the chain.';
    return [
        {
            id: 'understand',
            title: 'Understanding the request',
            kind: 'models',
            purpose:
                'Before any work, a fast open model reads your message with the last few exchanges and says what you want now, what kind of task it is, what you expect at the end, whether you are unhappy with the last answer, and what would be a misunderstanding. The agent works from that, and you see it as "Understood: …".',
            handles: ['you run it and give the link', 'where to download here? (about the Flutter page you pasted)', 'C:\\…\\flutter.zip — its your job now', 'create a presentation on …'],
            outcomeKinds: [],
            chain: chain(orderWith(FAST_ORDER, ['groq', 'nvidia']), 'fast'),
            chainNote: 'Open models first: gpt-oss and Qwen on Groq (about a second), then Nemotron on NVIDIA (2 to 8 seconds). After 10 seconds, or on any error, the older keyword rules decide.',
            effort: { reasoning: 'Low', level: 1, steps: '1 request', note: 'One JSON answer; skipped for small talk, "continue" and a first plain question.' },
            tools: { count: 0, names: [], note: 'None: it only reads the conversation.' },
            context: ['Your message', 'The last 4 exchanges, 700 characters each', 'The names and first lines of pasted text', 'The open folder'],
            approach: [
                'Resolve "it", "this" and "here" from the conversation',
                'A short or angry message continues the previous goal: do it, do not tell the user to',
                'A path to a zip or installer means install from it and carry on',
                'Pick the kind of work, which picks the method, the tier, references and file search',
                'Ask one question only when nothing sensible can be done without it',
            ],
            checks: ['A deck, Word file or PDF deliverable is always documents, whatever the model says', 'Every path and URL in the message is kept'],
            tokens: { typical: '700 to 1,200', note: 'Measured on 14 real and everyday requests: 14 of 14 right on Groq and on NVIDIA.' },
            strengths: ['Fixes the misreads of real chats: "here" with an attachment, "business model", "you run it"', 'Fails safe: without it, nothing changes'],
            weaknesses: ['Adds about a second before the work starts', 'A provider at its rate limit can make it time out, and the keyword rules decide'],
            improvements: ['Learn from complaints which understandings were wrong, and add them to the evaluation set'],
        },
        {
            id: 'chat',
            title: 'Small talk and general questions',
            kind: 'models',
            purpose: 'Greetings, thanks, and questions about the world rather than the project: answered at once from knowledge, with no project context.',
            handles: ['hi, thanks, ok', 'What is the difference between REST and GraphQL?', 'How does a hash map work?'],
            outcomeKinds: ['question'],
            chain: fast,
            chainNote: `Fast models first. ${paidNote}`,
            effort: { reasoning: 'Low', level: 1, steps: '1 step', note: 'Answered in a single request; the conversation resent is cut to the last 2 exchanges.' },
            tools: { count: 0, names: [], note: 'None: nothing to read or change.' },
            context: ['A short system prompt of about 150 tokens', 'Your message', 'The last 2 exchanges only'],
            approach: ['Recognise small talk or a general question (no project words in it)', 'Reply in 1 to 3 warm sentences, or a structured answer with a comparison and an example for a question', 'Never claim to have looked at files'],
            checks: ['None needed: nothing is changed'],
            tokens: { typical: '200 to 900', note: 'Measured: "hi" 224 tokens, "REST vs GraphQL" 919 (before 0.6.1: 2,191 and 13,823).' },
            strengths: ['About 90% cheaper than running the full agent', 'Warm and natural, matches your tone and language'],
            weaknesses: ['Cannot see your project, so it answers in general terms', 'A question that is secretly about the project can be misjudged'],
            improvements: ['Offer to run the full agent when the answer mentions "your project"'],
        },
        {
            id: 'fyx',
            title: 'Fyx: chores with no model',
            kind: 'no-model',
            purpose: 'Everyday chores run by the extension itself: git, zip, installing packages, starting a dev server, creating or moving files.',
            handles: ['zip the site folder', 'git pull', 'run the website locally', 'install the dependencies'],
            outcomeKinds: [],
            chain: [],
            chainNote: 'No model, no key, no tokens. Anything it cannot do is handed to the Auto chain.',
            effort: { reasoning: 'None', level: 0, steps: '1 to 3 commands', note: 'A fixed plan per chore; every command still asks permission.' },
            tools: { count: 1, names: ['run_command'], note: 'Runs the planned shell commands.' },
            context: ['Your request', 'Which tools your project has (package manager, git)'],
            approach: ['Match the request to a known chore or a chore learned from you or from other users (approved)', 'Fill in names from your request', 'Run the commands and report'],
            checks: ['Exit codes of each command'],
            tokens: { typical: '0', note: 'It runs in seconds and uses no tokens.' },
            strengths: ['Instant and free; saves your keys for real work', 'Learns new chores from corrections'],
            weaknesses: ['Only chores it knows; unusual phrasing falls through to a model'],
            improvements: ['More chores from the shared Fyx patterns you approve on the Learning page'],
        },
        {
            id: 'run',
            title: 'Run and preview',
            kind: 'models',
            purpose: 'Starts your project so you can see it, installing a missing toolchain from a file you supplied, and gives you the live link.',
            handles: ['run my Flutter app and give me the localhost link', 'install Flutter from this zip and run it', 'start the website'],
            outcomeKinds: ['run', 'setup'],
            chain: deep,
            chainNote: 'Strongest first.',
            effort: { reasoning: 'Provider default', level: 2, steps: '4 to 15 steps', note: 'Long installs and first builds run in the background and are checked on.' },
            tools: { count: ALL.length || 'all', names: ALL, note: 'All tools; run_command with background=true and the process tool do the work.' },
            context: ['The Run and preview method', 'What you supplied (paths, zips, links)', 'No design references and no code search: they do not help here'],
            approach: [
                'Find how the project starts',
                '"Not on PATH" is not "not installed": look in the usual places first',
                'Install from your zip into a folder outside OneDrive and the project, in the background',
                'Start it in the background, read the address it prints, open it with fetch_url',
                'Give the link and how to stop it; change nothing else',
            ],
            checks: [
                'The editor opens the link itself before the agent may give it, and loads it in a hidden browser; browser errors send it back',
                'After any code change, the compile check of the stack (Flutter analyze, errors only) must pass after the last edit',
                'An edit that would unbalance the brackets of a code file is refused before it is written',
                'A server is not started on a port that is taken: its own process is named, or a free port is offered when another program holds it',
                'At most 3 starts of the same app per task, then an honest report instead of more guesses',
                'Commands written for another shell (%USERPROFILE%, cmd /c, taskkill /PID, PowerShell in double quotes) are fixed or refused before they run',
            ],
            tokens: { typical: '15K to 60K', note: 'A first Flutter web build takes minutes, not tokens.' },
            strengths: ['Does the work instead of handing you commands', 'Reports the real address the server printed'],
            weaknesses: ['Steps that need administrator rights or a device still need you'],
            improvements: ['Remember where each toolchain was installed, per computer'],
        },
        {
            id: 'quick',
            title: 'Quick tasks',
            kind: 'models',
            purpose: 'Small, clear requests: a one-line fix, a rename, a short edit, running one command.',
            handles: ['rename this variable', 'add a null check in cart.js', 'run the tests'],
            outcomeKinds: ['quick'],
            chain: fast,
            chainNote: `Groq first (answers in a second or two), then Gemini lite, NVIDIA, Mistral. ${paidNote}`,
            effort: { reasoning: 'Low', level: 1, steps: '1 to 5 steps', note: 'Reasoning kept low for speed; no plan, no exploring.' },
            tools: { count: QUICK.length, names: QUICK, note: 'Read, search, edit and one command; nothing else is offered, to save tokens.' },
            context: ['The agent instructions (about 1.5K tokens)', 'The tools above', 'The 4 most likely files named up front', 'Lessons that match'],
            approach: ['Act at once with the fewest calls', 'Edit by line numbers', 'Run the project check if it has one'],
            checks: ['The editor\'s errors on the changed file come back with each edit'],
            tokens: { typical: '3K to 15K', note: 'First request about 2.2 to 3K tokens.' },
            strengths: ['Fast: Groq replies in about a second', 'Cheap'],
            weaknesses: ['Small context per request on Groq: a large file moves the task to another provider'],
            improvements: ['Learned order from real outcomes once a provider has 20+ tasks'],
        },
        {
            id: 'explain',
            title: 'Explaining a project',
            kind: 'models',
            purpose: 'Understanding code: how something works, what a project is, where a feature lives. Changes nothing.',
            handles: ['explain my project', 'how does login work?', 'where is the order total calculated?'],
            outcomeKinds: ['explain'],
            chain: fast,
            chainNote: 'Same fast chain; the project overview and main files travel with the request, so it usually answers in one step.',
            effort: { reasoning: 'Low', level: 1, steps: '1 to 3 steps', note: 'Answers from the code already supplied.' },
            tools: { count: READ.length, names: READ, note: 'Read-only tools. It cannot edit.' },
            context: ['The project\'s README (first 6,000 characters)', 'The 4 most-used code files (up to 12,000 characters)', 'A code map when the project is large'],
            approach: specialist('explain').method,
            checks: specialist('explain').finish,
            tokens: { typical: '3.6K to 6K', note: 'Measured: 3,648 tokens in 1 step (before: 9,900 in 5 steps).' },
            strengths: ['Cites path:line for each claim', 'One step on small and medium projects'],
            weaknesses: ['Very large projects still need several reads', 'Binary and generated files are skipped'],
            improvements: ['Keep a cached project summary so repeat questions cost less'],
        },
        {
            id: 'build',
            title: 'Building new things',
            kind: 'models',
            purpose: 'A new site, app, API or feature, from nothing: structure, files, running and checking it.',
            handles: ['build a playground site with a get started button', 'create a REST API for tasks', 'make a snake game'],
            outcomeKinds: ['build'],
            chain: deep,
            chainNote: `Strongest first: Gemini's 1M-token context carries multi-file work, then NVIDIA Nemotron Ultra, Mistral. OpenRouter's free router last. ${paidNote}`,
            effort: { reasoning: 'Provider default', level: 2, steps: '5 to 15 steps', note: 'Plans with a todo list, writes whole files, then checks them.' },
            tools: { count: BUILD.length, names: BUILD, note: 'Everything except project search (nothing to search yet).' },
            context: ['The agent instructions', 'The matching playbook (web, python, mobile, .NET, documents...)', 'A proven structure for the domain (landing, dashboard, store, auth...)', 'A design reference for anything with a screen', 'Your lessons'],
            approach: specialist('build').method,
            checks: [...specialist('build').finish, 'Web pages load in a hidden browser: errors, cut-off layout, invisible content', 'Build, type check and tests when the project has them'],
            tokens: { typical: '30K to 80K', note: 'Measured: a landing page 56K tokens; it writes real files, so it costs more than a fix.' },
            strengths: ['Starts from how strong projects are built, not a blank page', 'Cannot finish on a broken build'],
            weaknesses: ['Free models vary in craft; the design reference lifts the floor, not the ceiling', 'Long builds can hit a free daily limit mid-way (it switches keys, but not always enough)'],
            improvements: ['More domain structures (Flutter, payments, education)', 'Compare screenshots with the design reference'],
        },
        {
            id: 'change',
            title: 'Changing existing code',
            kind: 'models',
            purpose: 'Features and edits in a project that already exists: add, update, wire up, extend.',
            handles: ['add a dark mode toggle', 'add pagination to the orders list', 'connect the form to the API'],
            outcomeKinds: ['change'],
            chain: deep,
            chainNote: 'Strongest first, with the code map of the project up front.',
            effort: { reasoning: 'Provider default', level: 2, steps: '5 to 20 steps', note: 'Explore, plan, edit, verify.' },
            tools: { count: ALL.length || 'all', names: ALL, note: 'All tools, including project search.' },
            context: ['The agent instructions', 'The playbook for the project\'s stack', 'A code map: the most-used files and what they define', 'Files the request names', 'Your lessons and approved shared lessons'],
            approach: ['Find the relevant code with search, not folder by folder', 'Read only what is needed', 'Edit by line, then run the project\'s own checks', 'Fix what the editor reports on each edit'],
            checks: ['The project\'s tests, type check or build must pass after the last edit before it can finish'],
            tokens: { typical: '20K to 60K', note: 'Depends on how many files it must read.' },
            strengths: ['Edits by line number avoid most "text not found" retries', 'Reads only the files that matter'],
            weaknesses: ['Projects with no tests can only be checked by build or page load'],
            improvements: ['Remember which files each feature touches between tasks'],
        },
        {
            id: 'fix',
            title: 'Debugging',
            kind: 'models',
            purpose: 'Something is broken: reproduce it, find the cause, fix it, prove it.',
            handles: ['fix the bug: total() returns NaN for an empty cart', 'the login page shows a 500', 'tests are failing'],
            outcomeKinds: ['fix'],
            chain: deep,
            chainNote: 'Strongest first. When the same error repeats, the next steps go to the strongest model available with an instruction to fix the root cause.',
            effort: { reasoning: 'High on repeated errors', level: 3, steps: '5 to 15 steps', note: 'After an error repeats twice (even with other steps between), 2 steps run on the strongest model; after 5 repeats it stops instead of burning tokens.' },
            tools: { count: ALL.length || 'all', names: ALL, note: 'All tools.' },
            context: ['The agent instructions', 'The debugging method', 'The error text and likely files'],
            approach: specialist('fix').method,
            checks: specialist('fix').finish,
            tokens: { typical: '25K to 45K', note: 'Measured 32K to 46K on the cart bug.' },
            strengths: ['Reproduces first and proves the fix', 'Escalates to the strongest model on a stubborn error'],
            weaknesses: ['If the bug cannot be reproduced it says so and asks, which costs a turn'],
            improvements: ['Run the failing test automatically as the very first step'],
        },
        {
            id: 'design',
            title: 'Interface design',
            kind: 'models',
            purpose: 'How something looks: layout, spacing, type, colour, responsiveness, accessibility.',
            handles: ['redesign the pricing page', 'make the dashboard look professional', 'fix the layout on phones'],
            outcomeKinds: ['design'],
            chain: deep,
            chainNote: 'Strongest first. A design reference (downloaded library first, then 8 built-in styles) travels with the request.',
            effort: { reasoning: 'Provider default', level: 2, steps: '5 to 15 steps', note: 'Design system first, then screens, then the page check.' },
            tools: { count: ALL.length || 'all', names: ALL, note: 'All tools, plus find_image for real photos.' },
            context: ['The design method', 'One design reference with tokens (colours, type, spacing)', 'Domain structure for the kind of site'],
            approach: specialist('design').method,
            checks: [...specialist('design').finish, 'The page check scrolls the page and fails on text that never becomes visible'],
            tokens: { typical: '40K to 70K', note: 'Writes CSS and markup; largest outputs of any role.' },
            strengths: ['Starts from a real visual system', 'Checks phone width and accessibility'],
            weaknesses: ['No visual judgement of the final picture yet: it checks structure, not taste'],
            improvements: ['Screenshot comparison against the reference for a second opinion'],
        },
        {
            id: 'refactor',
            title: 'Refactoring',
            kind: 'models',
            purpose: 'Improve structure without changing behaviour.',
            handles: ['split this 800-line file', 'rename the service layer', 'remove the duplicate code'],
            outcomeKinds: ['refactor'],
            chain: deep,
            chainNote: 'Strongest first.',
            effort: { reasoning: 'Provider default', level: 2, steps: '8 to 25 steps', note: 'Tests before and after.' },
            tools: { count: ALL.length || 'all', names: ALL, note: 'All tools.' },
            context: ['The refactoring method', 'A code map', 'The files involved'],
            approach: specialist('refactor').method,
            checks: specialist('refactor').finish,
            tokens: { typical: '30K to 80K', note: 'Reads a lot before changing anything.' },
            strengths: ['Behaviour is checked by tests before and after'],
            weaknesses: ['Without tests it can only check that the build still passes'],
            improvements: ['Offer to write characterisation tests first when none exist'],
        },
        {
            id: 'data',
            title: 'Data and machine learning',
            kind: 'models',
            purpose: 'Datasets, training scripts, notebooks, metrics.',
            handles: ['train a churn classifier', 'clean this CSV', 'plot the monthly revenue'],
            outcomeKinds: ['data'],
            chain: deep,
            chainNote: 'Strongest first. Training runs are smoke-tested on a tiny sample, never run in full.',
            effort: { reasoning: 'Provider default', level: 2, steps: '6 to 20 steps', note: 'Baseline first, then the real model, with real metrics.' },
            tools: { count: ALL.length || 'all', names: ALL, note: 'All tools.' },
            context: ['The data method', 'The Python environment hints (venv, uv)', 'Shapes and a few rows, never whole datasets'],
            approach: specialist('data').method,
            checks: specialist('data').finish,
            tokens: { typical: '30K to 70K', note: 'Varies with how much exploration the dataset needs.' },
            strengths: ['Fixed seeds, held-out data and a baseline by default'],
            weaknesses: ['Cannot judge model quality on your real data without running it'],
            improvements: ['A reusable experiment template (config, metrics, saved pipeline)'],
        },
        {
            id: 'documents',
            title: 'Decks, documents and PDFs',
            kind: 'models',
            purpose: 'PowerPoint, Word and PDF files built by script from an outline, designed, then rendered and reviewed page by page until they are ready.',
            handles: ['make a 12-slide deck on Nepal floods', 'create a presentation on the business model of a hybrid store', 'write a project report as a PDF'],
            outcomeKinds: ['documents'],
            chain: deep,
            chainNote: 'Strongest first.',
            effort: { reasoning: 'Provider default', level: 2, steps: '6 to 20 steps', note: 'One build script, then check_document and fixes, at most three rounds.' },
            tools: { count: DOCS.length, names: DOCS, note: 'Build tools plus make_deck (decks from an outline, built with PptxGenJS), find_image (real photos with credits) and check_document (file checks and a visual review).' },
            context: ['The documents playbook (outline first, varied layouts, palette, grid, headline rules)', 'Library docs for python-pptx and python-docx on demand'],
            approach: [
                'Decks: the agent writes only the outline (a headline, points and a layout per slide); make_deck lays it out with tested designs and native, editable charts',
                'Gamma-style layouts: pictures filling one side, icon cards (85 Lucide icons drawn as native shapes), pill tags, steps, tables, galleries, timelines, callouts and a closing statement; 8 themes with their own font pairs; figures only with a source',
                'Real photos from Wikimedia Commons or a labelled frame',
                'Render the pages (its PDF copy, PowerPoint, Word or LibreOffice) and have Gemini review them as a reader would',
                'Fix what the review lists in the script and rebuild, as PPTAgent does',
            ],
            checks: [
                'Empty placeholders, content off the slide, tiny or overflowing text, empty or crowded slides, blank paragraphs, blank PDF pages',
                'A visual review of each page: cut-off text, contrast, walls of text, weak pictures, inconsistent design, a weak story, with scores for content, design and coherence',
            ],
            tokens: { typical: '35K to 80K', note: 'Each visual review is about 5K Gemini tokens (an 8-slide deck: 4.6K in, 0.2K out, 9 seconds).' },
            strengths: ['Never leaves a blank template box', 'Photos come with their credits', 'Sees the deck as you will, not just its XML'],
            weaknesses: ['Charts are drawn with matplotlib, so they are pictures, not editable charts', 'The visual review needs a Gemini key and PowerPoint, Word or LibreOffice (or the PDF copy)'],
            improvements: ['Native PowerPoint charts', 'Start from your own template when you attach one'],
        },
        {
            id: 'correction',
            title: 'Corrections',
            kind: 'models',
            purpose: 'You point at what is wrong (often with a screenshot); each point is fixed and verified separately.',
            handles: ['the button is still blue, and the title is cut off', 'No, use pnpm not npm'],
            outcomeKinds: [],
            chain: deep,
            chainNote: 'Strongest first.',
            effort: { reasoning: 'Provider default', level: 2, steps: '3 to 12 steps', note: 'Each point becomes its own item.' },
            tools: { count: ALL.length || 'all', names: ALL, note: 'All tools.' },
            context: ['A correction brief that numbers your points', 'Evidence read from your screenshot or notes'],
            approach: ['Number each point', 'Smallest change per point', 'Verify each one', 'End with what was wrong, what changed, how it was checked'],
            checks: ['Each point verified separately'],
            tokens: { typical: '15K to 40K', note: 'Usually fewer steps than the original task.' },
            strengths: ['Saves a lesson from each correction (and shares it if you chose to)'],
            weaknesses: ['A vague correction ("make it better") gives it little to verify'],
            improvements: ['Ask one clarifying question when a point cannot be verified'],
        },
        {
            id: 'reader',
            title: 'Attachment reader: documents and screenshots',
            kind: 'reader',
            purpose: 'Turns files you attach into text the agent can use: documents are read on your computer; screenshots go to a vision model only when needed.',
            handles: ['a PDF spec', 'a Word or Excel file', 'a screenshot of a bug', 'a zip of a project'],
            outcomeKinds: [],
            chain: VISION_MODELS.map(([provider, model]) => link(provider, 'vision', [model])),
            chainNote: 'Documents and text in screenshots are read locally with no model. A vision model is asked only when an image has little text or when layout and colour matter; only keys whose model can see images are used.',
            effort: { reasoning: 'None', level: 0, steps: 'Before the task starts', note: 'Local reading first; one vision call at most per image.' },
            tools: { count: 0, names: [], note: 'Not an agent: a reader.' },
            context: ['Each attached file', 'Long documents are summarised and saved in .freeagentcoder/attachments/'],
            approach: ['Detect the real format from the bytes, not the extension', 'Read locally: PDF, Word, PowerPoint, Excel, OpenDocument, EPUB, ZIP, e-mail, old Office files, text and code', 'OCR images on this computer', 'Ask a vision model only when needed'],
            checks: ['Reports plainly when a file could not be read, never describes an image it was not shown'],
            tokens: { typical: '0 to 3K', note: 'Local reading uses no tokens.' },
            strengths: ['Private: documents are read on your computer', '20+ formats'],
            weaknesses: ['Scanned pages with no text layer need a vision model (Gemini, Mistral, OpenAI or Anthropic key)'],
            improvements: ['Table structure from scanned PDFs'],
        },
        {
            id: 'pdf',
            title: 'Scanned PDF reader',
            kind: 'reader',
            purpose: 'PDFs with no text layer (scans): read natively by a model that accepts PDFs.',
            handles: ['a scanned contract', 'a photographed form'],
            outcomeKinds: [],
            chain: [link('gemini', 'vision', [PDF_READER_MODEL])],
            chainNote: 'Only Gemini reads PDFs natively; without a Gemini key it says so instead of guessing.',
            effort: { reasoning: 'None', level: 0, steps: 'Before the task starts', note: 'One request per document.' },
            tools: { count: 0, names: [], note: 'Not an agent: a reader.' },
            context: ['The PDF file'],
            approach: ['Try the text layer locally', 'Only if empty, send the PDF to Gemini'],
            checks: ['Page counts compared with what came back'],
            tokens: { typical: '2K to 20K', note: 'Depends on the page count.' },
            strengths: ['Handles scans a local reader cannot'],
            weaknesses: ['Needs a Gemini key'],
            improvements: ['Local OCR for scanned PDFs on machines without a Gemini key'],
        },
        {
            id: 'lessons',
            title: 'Lesson writer',
            kind: 'models',
            purpose: 'After a correction, writes the short general rule to remember (and to share, if you chose to).',
            handles: ['(automatic after a correction)'],
            outcomeKinds: [],
            chain: fast,
            chainNote: 'The quick-task chain: a lesson is a few sentences.',
            effort: { reasoning: 'Low', level: 1, steps: '1 request', note: 'One short completion; 60 s limit.' },
            tools: { count: 0, names: [], note: 'None.' },
            context: ['Your correction', 'The evidence from your screenshot', 'Your existing lessons (to avoid duplicates)'],
            approach: ['Write 1 to 2 general rules', 'Strip names, paths and secrets', 'Skip if it duplicates an existing lesson'],
            checks: ['A rule is only shared if it passes the privacy filter'],
            tokens: { typical: '500 to 1.5K', note: 'Tiny.' },
            strengths: ['Cheap, and runs in the background'],
            weaknesses: ['A lesson is only as good as the correction'],
            improvements: ['Merge near-duplicate lessons automatically'],
        },
    ] as Role[];
}
