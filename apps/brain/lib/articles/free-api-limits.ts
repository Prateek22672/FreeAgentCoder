/**
 * What each provider's free tier actually gives you, checked against the
 * providers' own documentation rather than repeated from other articles.
 *
 * The reason this page can win its searches is unusual: the whole category is
 * going stale at once. Google deleted its published free-tier table in
 * December 2025, Mistral moved its numbers behind a login, Together refuses to
 * publish fixed limits, Z.ai put its behind an account, and Cerebras converted
 * its free tier into a card-backed trial. Every listicle still quoting numbers
 * for those providers is quoting numbers that no longer exist.
 *
 * So the rule here: publish what the provider publishes, say "not published"
 * when it does not, never estimate, and date everything. A missing cell is
 * more useful than a confident guess.
 */
import type { Article, Block } from './existing';

const p = (text: string): Block => ({ type: 'p', text });
const h2 = (text: string): Block => ({ type: 'h2', text });
const ul = (items: string[]): Block => ({ type: 'ul', items });
const table = (headers: string[], rows: string[][]): Block => ({ type: 'table', headers, rows });
const callout = (text: string): Block => ({ type: 'callout', text });

/** Everything below was read from the provider's own pages on this date. */
export const CHECKED = '2026-09-30';

export const FREE_API_LIMITS: Article = {
    slug: 'free-ai-api-limits',
    title: 'Free AI API Limits in 2026: What Each Provider Really Gives',
    description:
        'Free tier limits for Gemini, Groq, Cerebras, Mistral, OpenRouter and more — taken from each provider’s own documentation, dated, with “not published” where nothing is published.',
    h1: 'Free AI API limits: what each provider actually gives you',
    dek: `Checked against the providers' own documentation on ${CHECKED}. Where a provider publishes no number, this page says so instead of inventing one — which is most of the difference between it and everything else you will find.`,
    updated: CHECKED,
    blocks: [
        p(
            'Every comparison of free AI API tiers has the same problem: the numbers move, and almost nobody rechecks them. Worse, several providers have stopped publishing limits altogether in the last year, so articles quoting confident figures are quoting figures that no longer exist anywhere official.',
        ),
        p('Here is what is actually published today, and by whom.'),

        h2('The short version'),
        table(
            ['Provider', 'Free?', 'Card?', 'Best free coding model', 'Context', 'Requests/day', 'Vision'],
            [
                ['Google Gemini', 'Yes', 'No', 'Gemini 3.8 Flash', '1,048,576', 'Not published', 'Yes'],
                ['Groq', 'Yes', 'No', 'openai/gpt-oss-120b', '131,072', '1,000', 'Yes, one model'],
                ['Mistral', 'Yes', 'No', 'Not published', 'Not published', 'Not published', 'Not published'],
                ['OpenRouter', 'Yes', 'No', 'Varies by model', 'Varies', '50, or 1,000', 'Varies'],
                ['Cohere', 'Trial key', 'No', 'Command A+', '128,000', '1,000 a month', 'Yes'],
                ['SambaNova', 'Yes', 'No', 'DeepSeek-V3.2', 'Not published', '20', 'Not published'],
                ['Cerebras', '**Trial only**', '**Yes**', 'openai/gpt-oss-120b', '65,536 on trial', 'Not published', 'Yes, 2 images'],
                ['NVIDIA NIM', 'Trial', 'Not published', 'Not published', 'Not published', 'Not published', 'Not published'],
                ['Z.ai / GLM', 'Some models', 'Not published', 'GLM-4.7-Flash', 'Not published', 'Not published', 'Yes'],
                ['Together AI', 'No', '—', 'One model at $0', '262,144', 'Not published', 'No'],
                ['DeepSeek', 'No', 'Yes', '—', '—', '—', '—'],
                ['GitHub Models', '**Retired**', '—', '—', '—', '—', '—'],
            ],
        ),
        p(
            'Four of those twelve do not belong in a free-tier comparison at all any more, which tells you how fast this moves. If you want two keys that cost nothing and need no card, take **Gemini** and **Groq**.',
        ),

        h2('Google Gemini — generous, but the numbers are secret now'),
        p(
            'Gemini has the best free offer for coding: a genuinely large context window, vision, and no card. What it no longer has is a published limit. On 6 December 2025 Google removed the free-tier rate-limit table from its documentation, and replaced it with a line telling you to look in AI Studio for your own project.',
        ),
        p('For the record, this is the last table Google published, the day before it disappeared:'),
        table(
            ['Model', 'Requests/min', 'Tokens/min', 'Requests/day'],
            [
                ['Gemini 2.5 Pro', '2', '125,000', '50'],
                ['Gemini 2.5 Flash', '10', '250,000', '250'],
                ['Gemini 2.5 Flash-Lite', '15', '250,000', '1,000'],
                ['Gemini 2.0 Flash', '15', '1,000,000', '200'],
            ],
        ),
        callout(
            'You will see it claimed everywhere that Google then cut the free tier by about 92%, to 20 requests a day. **We cannot verify that.** It appears only in user posts on Google’s own developer forum and in articles repeating them; Google’s changelog has no entry for any free-tier change in December 2025. The removal of the table is a fact. The replacement number is not — treat anyone stating it confidently with suspicion, including us.',
        ),
        ul([
            'Best coding model: **Gemini 3.8 Flash** — 1,048,576 tokens in, 65,536 out, and it reads images and PDFs.',
            'Your real limits: only visible in [AI Studio](https://aistudio.google.com) for your project.',
            '**Your data is used for training.** Google’s terms for unpaid use say so explicitly, and add that human reviewers may read your inputs and outputs. Do not send anything confidential through a free key.',
            'Check the live page: [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).',
            '[Get a free Gemini key](/go/gemini) — no card.',
        ]),

        h2('Groq — the fastest, and it still publishes real numbers'),
        ul([
            '**1,000 requests a day** and 30 a minute on the main coding models, with 200,000 tokens a day.',
            'Best coding model: **openai/gpt-oss-120b**, 131,072 context.',
            'Vision works on one model, `qwen/qwen3.8-27b`, at up to 3 images per request.',
            'A caution: Groq’s own two documentation pages disagree about whether this table is the free tier or the paid Developer plan. We read it as the free tier, but Groq does not label it.',
            'Check the live page: [Groq rate limits](https://console.groq.com/docs/rate-limits). [Get a free Groq key](/go/groq).',
        ]),

        h2('Cerebras — no longer free, and this catches people out'),
        p(
            'Cerebras used to be one of the best free options, and a great deal of advice on the internet still says so. It is not true any more, and the wording in their own documentation is unambiguous: "Is there a permanently free tier? No."',
        ),
        ul([
            'What you get instead: **$5 of credits that expire 30 days after they are granted**.',
            '**A verified payment method is required** before the API works at all.',
            'On the trial the context window is 65,536 rather than the 131,072 paid users get, and it is 5 requests a minute.',
            'Check the live page: [Cerebras rate limits](https://inference-docs.cerebras.ai/support/rate-limits).',
        ]),

        h2('OpenRouter — one free tier with an odd rule'),
        ul([
            'Models with an ID ending `:free` cost nothing. 20 requests a minute.',
            '**50 requests a day** — unless you have ever bought $10 of credits, which permanently raises it to **1,000 a day**. It is a lifetime threshold, not a balance, so a single $10 top-up years ago still counts.',
            'Which models are free changes; there is no fixed catalogue.',
            'Check the live page: [OpenRouter limits](https://openrouter.ai/docs/api_reference/limits). [Get a free OpenRouter key](/go/openrouter).',
        ]),

        h2('Cohere — a real free key, but small and personal-use only'),
        ul([
            'The trial key needs no card and is waiting on the API Keys page as soon as you sign up.',
            '**1,000 calls a month** across everything, and 20 chat requests a minute. An agent uses several calls per task, so treat it as a backup, not a main key.',
            'Cohere\u2019s pricing page: "Trial keys are not permitted to be used for production or commercial purposes." Personal coding is fine; a product serving other people is not.',
            'Best free coding model: **Command A+** (`command-a-plus-05-2026`), 128,000 tokens of context, with tools and images.',
            'Check the live pages: [Cohere rate limits](https://docs.cohere.com/docs/rate-limits) and [pricing](https://cohere.com/pricing). [Get a free Cohere key](/go/cohere).',
        ]),

        h2('Mistral — free, no card, limits not published'),
        ul([
            '"Free mode" is on by default and needs no credit card.',
            'The limits exist but are only shown in your account, under API › Limits. Mistral counts tokens per minute and requests per second rather than requests per day.',
            'Whether free-tier data trains their models is not stated in writing; their plan table lists an opt-out for paid plans and leaves the free column blank.',
            'Check the live page: [Mistral usage limits](https://docs.mistral.ai/admin/billing-usage/usage-limits). [Get a free Mistral key](/go/mistral).',
        ]),

        h2('The ones to cross off your list'),
        ul([
            '**GitHub Models** — fully retired on 30 July 2026. The playground, the catalogue, the inference API and bring-your-own-key are all gone.',
            '**DeepSeek** — no free tier, no trial. Pay per token only, though it is inexpensive and halves its prices off-peak.',
            '**Together AI** — no free tier, and it deliberately publishes no fixed limits. One model currently sits at $0.',
            '**NVIDIA NIM** — free for prototyping, genuinely, but no numeric limit is published anywhere in NVIDIA’s documentation. The figures you will see quoted come from forum posts.',
            '**Z.ai / GLM** — three models are priced at zero, but watch the naming: GLM-5.3-**Flash** is *not* free despite the name, while GLM-4.7-Flash is.',
        ]),

        h2('How to actually get a day’s work done on free tiers'),
        p(
            'One key runs out. That is the whole problem, and the fix is not a better provider — it is more than one. Limits are counted per provider, so a Gemini key and a Groq key are two separate allowances, while two Gemini keys on one Google account share the same one.',
        ),
        p(
            '[FreeAgentCoder](/) is built around that: add several free keys, and when one hits its daily limit mid-task it moves to the next and carries on, instead of failing. It also reads the rate-limit headers providers send back, so it knows what is left before it starts something that will not finish.',
        ),

        h2('Why so many of these cells say “not published”'),
        p(
            'Because that is the honest state of it, and the direction is one-way. In the last year Google deleted its table, Mistral moved its numbers behind a login, Z.ai did the same, Together stated outright that it publishes no fixed limits, and Cerebras replaced its free tier with a trial. Any page still showing a full grid of confident numbers for all of these is either out of date or making them up.',
        ),
    ],
    faq: [
        {
            q: 'Which free AI API is best for coding?',
            a: 'Gemini, for the context window — a million tokens holds an entire project, and it reads screenshots. Groq is faster for short work and still publishes a real daily limit. Using both is better than choosing, since their limits are separate.',
        },
        {
            q: 'What is Gemini’s free tier limit?',
            a: 'Google no longer publishes one. It removed the free-tier rate limit table from its documentation on 6 December 2025 and now directs you to AI Studio to see your own project’s limits. Anyone quoting you a current number is not getting it from Google.',
        },
        {
            q: 'Is Cerebras still free?',
            a: 'No. As of September 2026 their documentation says there is no permanently free tier — it is $5 of credits that require a verified payment method and expire after 30 days. A lot of advice online has not caught up with this.',
        },
        {
            q: 'Do any of these need a credit card?',
            a: 'Gemini, Groq, Mistral, OpenRouter, Cohere and SambaNova do not. Cerebras, DeepSeek and Together AI do. For Z.ai and NVIDIA it is not published.',
        },
        {
            q: 'Will my code be used to train their models?',
            a: 'For Gemini’s free tier, yes, explicitly — Google’s terms say human reviewers may read free-tier inputs and outputs, so do not send confidential code through a free key. For most other providers it is simply not published, which is not the same as no.',
        },
        {
            q: 'How many free keys should I have?',
            a: 'One per provider, from two or three different providers. A second key from the same account shares the same allowance and adds nothing; a key from a different provider is a genuinely separate one.',
        },
    ],
};
