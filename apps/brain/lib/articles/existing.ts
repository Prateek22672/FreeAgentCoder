/**
 * Long-form SEO pages: one topic per real search query, kept factual and consistent with the rest of the site.
 * Carried over from apps/site with the same slugs, so their URLs keep working after the move.
 */

export type Block =
  | { type: 'p'; text: string }
  | { type: 'h2'; text: string; id?: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'callout'; text: string };

export interface Article {
  slug: string;
  /** <title>. Kept under ~60 characters where possible. */
  title: string;
  /** Meta description, ~150-160 characters. */
  description: string;
  h1: string;
  dek: string;
  updated: string;
  blocks: Block[];
  faq: { q: string; a: string }[];
}

const p = (text: string): Block => ({ type: 'p', text });
const h2 = (text: string): Block => ({ type: 'h2', text });
const ul = (items: string[]): Block => ({ type: 'ul', items });
const ol = (items: string[]): Block => ({ type: 'ol', items });
const table = (headers: string[], rows: string[][]): Block => ({ type: 'table', headers, rows });
const callout = (text: string): Block => ({ type: 'callout', text });

export const COPILOT_ALTERNATIVE: Article = {
  slug: 'free-copilot-alternative',
  title: 'A Free GitHub Copilot Alternative for VS Code',
  description:
    'Want a free alternative to GitHub Copilot? FreeAgentCoder is a free, open-source AI coding agent for VS Code that runs on your own free Gemini, Groq or Cerebras API key. No subscription.',
  h1: 'A free alternative to GitHub Copilot',
  dek: "GitHub Copilot's free tier has monthly limits, and more means a subscription. FreeAgentCoder is free, open source, and runs on API keys you can get for free in about a minute.",
  updated: '2026-09-22',
  blocks: [
    p('If you want an AI coding assistant in VS Code without paying a monthly fee, the usual options are a local model (slow on most laptops, and weaker than the big hosted ones) or a subscription like GitHub Copilot, Cursor or Claude Code. FreeAgentCoder is a third option: it is a free, MIT-licensed VS Code extension that runs on API keys you bring yourself — several providers give those keys away free.'),
    h2('The core difference: subscription vs. bring your own key'),
    table(
      ['', 'GitHub Copilot', 'FreeAgentCoder'],
      [
        ['Cost', 'A free tier with monthly limits; paid plans for more', 'Free. MIT licensed. No plan to upgrade to.'],
        ['What you connect', "Your GitHub account (Copilot's own models)", 'Your own API keys — Gemini, Groq, Cerebras, Mistral, OpenRouter (free), or OpenAI/Anthropic (paid, optional)'],
        ['Usage limits', 'Set by your Copilot plan', "Set by whichever provider's free tier you're using — add more keys to raise the ceiling yourself"],
        ['Where keys/tokens live', "GitHub's servers", "Your device only, encrypted in VS Code's Secret Storage"],
      ],
    ),
    p("This isn't a spec-for-spec Copilot clone — Copilot has deep GitHub integration and inline completions tuned over years by a large team. FreeAgentCoder is an agent: it plans a task, reads and edits files across your project, runs your build and tests, and keeps going until they pass, rather than only suggesting the next line as you type."),
    h2('What you get for free'),
    ul([
      'A real agent, not just autocomplete: it explores your project, makes a plan, edits multiple files, runs your tests, and fixes what breaks.',
      'Automatic failover across every key you add — when one provider rate-limits you, the next takes over mid-task.',
      "Senior mode for bigger asks: an environment check, a stack playbook, required quality checks, and an honest report of what passed and what didn't.",
      'Attachments: paste a screenshot, a PDF or a long spec and it reads it before it starts.',
      'Everything visible: a live plan, inline diffs, live command output, and one-click undo.',
    ]),
    h2('What it costs you instead of money'),
    ul([
      'A couple of minutes to create a free API key (Gemini, Groq or Cerebras all work).',
      'You live inside each provider\'s free-tier limits, though adding a second or third key spreads the load — the extension tells you how many you probably need.',
      "It's newer and smaller than Copilot, with a much smaller team behind it.",
    ]),
    callout('FreeAgentCoder is not affiliated with, endorsed by, or a product of GitHub, Microsoft or any other company named on this page.'),
  ],
  faq: [
    { q: 'Is FreeAgentCoder really free, unlike Copilot?', a: 'Yes. The extension itself is free and MIT licensed with no subscription. You run it on API keys from providers with free tiers (Gemini, Groq, Cerebras, Mistral, OpenRouter), so your only cost is whatever that provider charges — which is nothing on their free plans.' },
    { q: 'Can I use it alongside GitHub Copilot?', a: "Yes, they don't conflict. Some people keep Copilot for inline completions and use FreeAgentCoder for larger agentic tasks." },
    { q: 'Do I need a credit card?', a: "No. Gemini, Groq and Cerebras all offer API keys with a free tier that doesn't require a card to start." },
  ],
};

export const GEMINI_API_VSCODE: Article = {
  slug: 'gemini-api-key-vscode',
  title: 'Free Gemini API Key in VS Code: Setup Guide',
  description:
    'How to get a free Google Gemini API key and use it for AI coding in VS Code with FreeAgentCoder — a free agent with a 1M-token context window, no subscription.',
  h1: 'Use a free Gemini API key for AI coding in VS Code',
  dek: "Google's Gemini API has a genuinely useful free tier with a 1M-token context window — enough to hand an agent your whole project. Here's how to get a key and put it to work.",
  updated: '2026-09-16',
  blocks: [
    h2('Get a free Gemini API key'),
    ol([
      'Go to aistudio.google.com/apikey and sign in with a Google account.',
      'Click "Create API key" and choose or create a Google Cloud project (no billing needed for the free tier).',
      'Copy the key it generates. It looks like AIza… — keep it private, the same as a password.',
    ]),
    h2('Add it to FreeAgentCoder'),
    ol([
      'Install FreeAgentCoder from the VS Code Marketplace.',
      'Open Settings → API Keys → Add API key, choose Gemini, and paste the key.',
      "It's checked with Google immediately and, once valid, encrypted in VS Code's Secret Storage on your device — never uploaded anywhere else.",
    ]),
    h2('Why Gemini is worth having in the mix'),
    ul([
      "A 1M-token context window — large enough to include most of a real project's relevant files in one request, which is why FreeAgentCoder routes complex, multi-file tasks to it by default.",
      "A daily request quota rather than a tight per-minute one, so it holds up over a longer task.",
      "Doesn't publish rate-limit headers the way Groq or Cerebras do, so FreeAgentCoder tracks your Gemini usage locally instead.",
    ]),
    callout('Free-tier limits change over time — check ai.google.dev/pricing for the current numbers before relying on an exact figure.'),
    h2('Pair it with a fast key'),
    p('Gemini is strong for large, complex work but not the fastest for quick questions. Add a Groq or Cerebras key too — FreeAgentCoder sends short questions and small edits there, and saves Gemini for builds, debugging and multi-file changes. That combination, entirely free, covers most day-to-day coding.'),
  ],
  faq: [
    { q: 'Does the free Gemini API key expire?', a: "Keys don't expire on their own, but Google can rotate or revoke a key you regenerate. If FreeAgentCoder reports a key as invalid, create a new one and swap it in Settings → API Keys." },
    { q: 'Is the free tier enough for real projects?', a: "For most individual work, yes. Its daily request quota and 1M-token context handle large multi-file tasks well. If you hit the ceiling, add a second Gemini key or a key from another provider — FreeAgentCoder switches over automatically." },
    { q: 'Does Google see my code?', a: "Your code goes directly from your editor to Google's API when you use a Gemini key, the same as any app using that API. Check Google's Gemini API terms for its current data-use policy before working on sensitive code." },
  ],
};

export const BEST_FREE_AI_CODING: Article = {
  slug: 'best-free-ai-for-coding',
  title: 'Groq vs Cerebras vs Gemini: Best Free AI for Coding',
  description:
    'A comparison of the free AI APIs worth using for coding in 2026: Gemini, Groq, Cerebras, Mistral and OpenRouter — speed, context size, limits, and which to pick.',
  h1: 'Groq vs Cerebras vs Gemini: the best free AI APIs for coding',
  dek: "There isn't one best free model for coding — there's a best one for each kind of task. Here's how the free tiers actually differ, and why using more than one at once beats picking just one.",
  updated: '2026-09-16',
  blocks: [
    table(
      ['Provider', 'Best at', 'Watch out for'],
      [
        ['Gemini', 'Large, complex, multi-file work — 1M-token context', "Daily quota; doesn't report rate-limit headers"],
        ['Groq', 'Very fast answers to quick questions and small edits', 'Small per-minute token limit'],
        ['Cerebras', 'Fast, similar use case to Groq', 'Per-minute request limit'],
        ['Mistral', 'A second free key to spread load across', 'Free plan needs phone verification'],
        ['OpenRouter', 'Free models from several model makers behind one key', 'Daily request limit; quality varies by which free model is available'],
      ],
    ),
    h2('Why one key is never enough'),
    p("Every free tier has a ceiling, and you'll hit it in the middle of something eventually — that's the actual complaint people have with free AI coding tools, not model quality. The fix isn't picking the single 'best' provider, it's holding keys from two or three of them so a rate limit on one just hands the task to the next."),
    h2('A routing strategy that costs nothing'),
    ul([
      'Quick questions, small edits, "explain this function": Groq or Cerebras — both answer in a second or two.',
      'Builds, debugging, multi-file changes: Gemini, for its context window and daily (not per-minute) quota.',
      "Backup capacity: Mistral and OpenRouter, so a rate limit on your main keys doesn't stop the task.",
    ]),
    p('FreeAgentCoder automates exactly this: it classifies each request as quick or complex and routes it accordingly, then fails over to your next key the moment one is rate-limited — so the strategy above happens without you thinking about it.'),
    h2('A rough sizing rule'),
    p('For steady daily use, two to three keys from two different providers is usually enough to stop noticing rate limits. If your tasks are large (long multi-file builds), weight that toward Gemini; if they are short and frequent, weight it toward Groq or Cerebras.'),
    callout('Free-tier limits change often. Check each provider\'s own pricing page for current numbers before planning around an exact figure.'),
  ],
  faq: [
    { q: 'Which is fastest for coding?', a: "Groq and Cerebras are both built for low-latency inference and answer in roughly a second or two — noticeably faster than Gemini for short requests, though Gemini's larger context window wins on big, complex tasks." },
    { q: "Do I have to pick just one provider?", a: "No — and you shouldn't. Using two or three free keys from different providers, with something switching between them automatically, is what actually removes rate-limit friction." },
    { q: 'Is a paid key ever worth it?', a: "Only if the free tiers genuinely aren't enough for how much you code. FreeAgentCoder only reaches for a paid OpenAI or Anthropic key automatically when you have no free key active." },
  ],
};

export const EXISTING_ARTICLES = [COPILOT_ALTERNATIVE, GEMINI_API_VSCODE, BEST_FREE_AI_CODING];
