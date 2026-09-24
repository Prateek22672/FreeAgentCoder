/**
 * Written for the search people actually make — "how to get free api key for
 * gemini", "free gemini api key", "can i use gemini api for free", "use free
 * api key in vs code" — and for what they do next, which is look for something
 * to plug the key into.
 *
 * Deliberately no per-model rate-limit numbers: Google changes them often, and
 * a stale table is worse than a link to the live one.
 */
import type { Article, Block } from './existing';

const p = (text: string): Block => ({ type: 'p', text });
const h2 = (text: string): Block => ({ type: 'h2', text });
const ul = (items: string[]): Block => ({ type: 'ul', items });
const ol = (items: string[]): Block => ({ type: 'ol', items });
const table = (headers: string[], rows: string[][]): Block => ({ type: 'table', headers, rows });
const callout = (text: string): Block => ({ type: 'callout', text });

const AI_STUDIO = 'https://aistudio.google.com/apikey';
const RATE_LIMITS = 'https://ai.google.dev/gemini-api/docs/rate-limits';
const TERMS = 'https://ai.google.dev/gemini-api/terms';

export const GEMINI_KEY: Article = {
    slug: 'free-gemini-api-key-vs-code',
    title: 'How to Get a Free Gemini API Key and Use It in VS Code',
    description:
        'Get a free Google Gemini API key in about two minutes, with no credit card, and use it in VS Code to run an AI coding agent on your own key.',
    h1: 'How to get a free Gemini API key and use it in VS Code',
    dek: 'Two minutes, no credit card, no billing account. Then the part most guides skip: what to actually do with the key once you have it.',
    updated: '2026-09-24',
    blocks: [
        p(
            'Google gives away a free tier of the Gemini API. You sign in with an ordinary Google account, create a key, and start making requests — no credit card, no billing account, no trial that expires. This page walks through getting the key, then plugging it into VS Code so it does something useful.',
        ),

        h2('Get the key'),
        ol([
            `Open [Google AI Studio's API keys page](${AI_STUDIO}).`,
            'Sign in with your Google account. A personal account is fine.',
            'Click **Create API key**. If it asks which project to use, let it create one, or pick any existing Google Cloud project — you are not enabling billing on it.',
            'Copy the key. It starts with `AIza`. This is the only time it is shown in full, so paste it where you need it now.',
        ]),
        callout(
            'One key per Google account. Creating a second key on the same account does not give you more capacity — both keys draw on the same free limits. If you want a higher ceiling, add a key from a different provider instead.',
        ),

        h2('Use it in VS Code'),
        p(
            'A key on its own does nothing. You need something in your editor that makes requests with it. [FreeAgentCoder](/) is a free, open-source VS Code extension built for exactly this: you bring free keys, it does the coding work.',
        ),
        ol([
            'Install [FreeAgentCoder from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=PrateekKoratala.freeagentcoder).',
            'Open it from the right side bar, or run **FreeAgentCoder: Manage API Keys** from the Command Palette.',
            'Paste the key. It recognises a Gemini key by its shape and selects the provider for you.',
            'Ask for something real — "add a dark mode toggle to the settings page", or "why does this test fail?" It plans, edits files, runs your tests, and shows every step.',
        ]),
        p(
            'The key is stored encrypted in VS Code Secret Storage — your operating system keychain — and is sent only to Google, straight from your editor. It is never uploaded anywhere else.',
        ),

        h2('What the free tier actually gives you'),
        p(
            'Free Gemini usage is limited per minute and per day, and the exact numbers differ by model and change regularly. Rather than print a table that goes stale, here is the live one: [Gemini API rate limits](' +
                RATE_LIMITS +
                '). What matters in practice:',
        ),
        ul([
            'Limits are counted per project, not per key, so extra keys on one account do not help.',
            'There are two ceilings: requests per minute, which you hit during a burst of work, and requests per day, which ends your session until it resets.',
            'A per-minute limit is a pause. A daily limit is a wall — the useful fix is a second provider, not a second Gemini key.',
            'Adding billing moves you out of the free tier. You do not need to, and nothing here asks you to.',
        ]),

        h2('When one key is not enough'),
        p(
            'Several companies give away a free tier, and their limits are separate. Using more than one is the difference between an afternoon of work and stopping at lunchtime. FreeAgentCoder moves a task from one key to the next automatically when a provider is rate-limited or out of daily quota, so the work continues instead of failing.',
        ),
        table(
            ['Provider', 'Free key', 'Good for'],
            [
                ['Google Gemini', 'Yes, no card', 'Long, multi-file work and reading screenshots'],
                ['Groq', 'Yes, no card', 'Very fast replies on small tasks'],
                ['Cerebras', 'Yes, no card', 'Fast replies, generous free limits'],
                ['Mistral', 'Yes, no card', 'A solid all-rounder and a second vision option'],
                ['OpenRouter', 'Yes, no card', 'A pool of free community models as a last resort'],
            ],
        ),
        p('Each provider has its own signup link inside the extension, so you never have to hunt for them.'),

        h2('If the key stops working'),
        ul([
            '**429, "quota exceeded"** — you hit a per-minute or per-day limit. Wait, or let another key take over.',
            '**400, "API key not valid"** — the key was copied with a space or truncated. Create a new one and paste it again.',
            '**403, "user location is not supported"** — the Gemini free tier is not offered in every country yet. A different provider is the fix.',
            '**It worked yesterday and not today** — check whether the key was restricted in Google Cloud, or the project was deleted.',
        ]),

        h2('Keep the key to yourself'),
        ul([
            'Never commit a key to a repository. If you do, revoke it in AI Studio immediately — bots scan public commits within minutes.',
            'Never paste a key into a website that offers to "test" it for you.',
            'Revoke and recreate from the same [API keys page](' + AI_STUDIO + ') at any time; it takes seconds.',
            'Keys in FreeAgentCoder are stored in your system keychain and are never shown again after you save them.',
        ]),
    ],
    faq: [
        {
            q: 'Is the Gemini API really free?',
            a: 'Yes, there is a free tier that needs no credit card and no billing account. It is rate-limited per minute and per day, and those limits change — check Google’s rate limits page for the current numbers. Adding billing moves you to a paid tier, which you do not have to do.',
        },
        {
            q: 'Do I need a credit card?',
            a: 'No. Creating a key in Google AI Studio requires only a Google account.',
        },
        {
            q: 'Will Google use my code to train its models?',
            a: 'Read the current terms before working on anything sensitive: Google has historically treated free-tier usage differently from paid usage in this respect. The terms are at ai.google.dev/gemini-api/terms. This applies to the provider, not to the extension — FreeAgentCoder has no server and never receives your code.',
        },
        {
            q: 'Can I use the same key on two computers?',
            a: 'Yes. A key is not tied to a device. Both machines draw on the same free limits, so heavy use on one leaves less for the other.',
        },
        {
            q: 'How many free keys should I add?',
            a: 'One per provider, from different providers. A second key from the same Google account shares the same quota and adds nothing; a key from Groq or Cerebras adds a genuinely separate allowance.',
        },
        {
            q: 'What happens when I hit the daily limit?',
            a: 'Requests fail with a 429 until it resets. FreeAgentCoder sets that key aside until the reset instead of retrying it, hands the task to your next key, and warns you before a task starts if the remaining limits look too small for it.',
        },
    ],
};
