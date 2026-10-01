/**
 * Recognising a key by its prefix, so pasting one picks the right provider
 * by itself. Mistral has no stable public prefix, so it stays undetected.
 */
const PREFIXES: [prefix: string, provider: string][] = [
    ['sk-or-v1-', 'openrouter'],
    ['sk-ant-', 'anthropic'],
    ['AIza', 'gemini'],
    ['gsk_', 'groq'],
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
    { id: 'openrouter', goodFor: 'Free models from several makers behind one key' },
    { id: 'mistral', goodFor: 'Optional: free only after choosing the Experiment plan and verifying a phone number' },
    { id: 'cohere', goodFor: 'Optional: 1,000 calls a month, for personal use only' },
];

/** What the user will see on the provider's site, so they don't have to hunt for it. */
export const KEY_STEPS: Record<string, string[]> = {
    gemini: ['Sign in with your Google account.', 'Click "Create API key" and pick any project.', 'Copy the key — it starts with AIza.'],
    groq: ['Sign in with Google or GitHub.', 'Click "Create API Key" and name it.', 'Copy it straight away — it starts with gsk_ and is shown only once.'],
    cohere: ['Sign up; no card is asked for.', 'Your trial key is on the API Keys page. Copy it.', 'Trial keys allow 1,000 calls a month and are for personal, non-commercial use.'],
    mistral: ['Sign in, then choose the free "Experiment" plan and verify your phone number. Without that plan, Mistral keys are refused.', 'Open API Keys, create one, and copy it.'],
    openrouter: ['Sign in with Google or GitHub.', 'Click "Create Key" and copy it — it starts with sk-or-v1-.'],
    openai: ['Open API keys in your OpenAI account.', 'Create a new secret key and copy it — it is shown only once.'],
    anthropic: ['Open API keys in the Anthropic console.', 'Create a key and copy it — it starts with sk-ant-.'],
};
