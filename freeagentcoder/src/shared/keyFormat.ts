/**
 * Recognising a key by its prefix, so pasting one picks the right provider
 * by itself. Mistral has no stable public prefix, so it stays undetected.
 */
const PREFIXES: [prefix: string, provider: string][] = [
    ['sk-or-v1-', 'openrouter'],
    ['sk-ant-', 'anthropic'],
    ['AIza', 'gemini'],
    ['gsk_', 'groq'],
    ['nvapi-', 'nvidia'],
    ['csk-', 'cerebras'],
    ['sk-proj-', 'openai'],
    ['sk-', 'openai'],
];

/** The provider a pasted key belongs to, when its prefix gives it away. */
export function detectProvider(secret: string): string | undefined {
    const key = secret.trim();
    return PREFIXES.find(([prefix]) => key.startsWith(prefix))?.[1];
}

/**
 * The recommended free setup: one key from each provider, most useful first.
 * Different providers have separate limits; a second key from the same
 * account shares that account's limits, so it adds little or nothing.
 */
export const RECOMMENDED_SETUP: { id: string; goodFor: string }[] = [
    { id: 'gemini', goodFor: 'Complex builds and big projects: a 1M-token context' },
    { id: 'groq', goodFor: 'Very fast answers and small edits' },
    { id: 'nvidia', goodFor: 'Big open models (Kimi, Nemotron, GLM) for complex builds' },
    { id: 'openrouter', goodFor: 'Free models from several makers behind one key' },
    { id: 'cohere', goodFor: 'Optional: 1,000 calls a month, for personal use only' },
];

/** What the user will see on the provider's site, so they don't have to hunt for it. */
export const KEY_STEPS: Record<string, string[]> = {
    gemini: ['Sign in with your Google account.', 'Click "Create API key" and pick any project.', 'Copy the key — it starts with AIza.'],
    groq: ['Sign in with Google or GitHub.', 'Click "Create API Key" and name it.', 'Copy it straight away — it starts with gsk_ and is shown only once.'],
    cohere: ['Sign up; no card is asked for.', 'Your trial key is on the API Keys page. Copy it.', 'Trial keys allow 1,000 calls a month and are for personal, non-commercial use.'],
    mistral: ['Sign in, then choose the free "Experiment" plan and verify your phone number. Without that plan, Mistral keys are refused.', 'Open API Keys, create one, and copy it.'],
    nvidia: ['Sign in or create a free NVIDIA developer account; no card is asked for.', 'Open any model page (for example Kimi K3) and click "Get API Key", then "Generate Key".', 'Copy it — it starts with nvapi-. Other NVIDIA keys (such as NGC registry keys) do not work here.'],
    openrouter: ['Sign in with Google or GitHub.', 'Click "Create Key" and copy it — it starts with sk-or-v1-.'],
    openai: ['Open API keys in your OpenAI account.', 'Create a new secret key and copy it — it is shown only once.'],
    anthropic: ['Open API keys in the Anthropic console.', 'Create a key and copy it — it starts with sk-ant-.'],
};

/**
 * Which keys work on a free tier with no card, and which do not, said plainly
 * where keys are added. Checked against each provider's own pages, 1 October 2026.
 */
export const FREE_KEYS: { name: string; note: string }[] = [
    { name: 'Google Gemini', note: 'Free daily limit, no card' },
    { name: 'Groq', note: '1,000 requests a day, no card' },
    { name: 'OpenRouter', note: 'Free models, 50 requests a day, no card' },
    { name: 'Cohere', note: '1,000 calls a month, no card, personal use only' },
];

export const NOT_FREE_KEYS: { name: string; note: string }[] = [
    { name: 'Mistral', note: 'refused unless you pick its free plan and verify a phone' },
    { name: 'Cerebras', note: 'needs a card' },
    { name: 'OpenAI', note: 'paid only' },
    { name: 'Anthropic (Claude)', note: 'paid only' },
    { name: 'DeepSeek', note: 'needs a top-up' },
    { name: 'Together AI', note: 'needs a $5 purchase' },
    { name: 'Moonshot (Kimi)', note: 'needs a top-up' },
];

export const SHARED_KEY_WARNING =
    'Keys copied from websites, videos or GitHub do not work: providers find and cancel them within hours. Make your own; it takes a minute and is free.';
