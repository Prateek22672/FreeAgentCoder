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

/** What the user will see on the provider's site, so they don't have to hunt for it. */
export const KEY_STEPS: Record<string, string[]> = {
    gemini: ['Sign in with your Google account.', 'Click "Create API key" and pick any project.', 'Copy the key — it starts with AIza.'],
    groq: ['Sign in with Google or GitHub.', 'Click "Create API Key" and name it.', 'Copy it straight away — it starts with gsk_ and is shown only once.'],
    cerebras: ['Sign in, then open API Keys in the sidebar.', 'Generate a key and copy it — it starts with csk-.'],
    mistral: ['Sign in, then verify your phone number (the free "Experiment" plan needs it).', 'Open API Keys, create one, and copy it.'],
    openrouter: ['Sign in with Google or GitHub.', 'Click "Create Key" and copy it — it starts with sk-or-v1-.'],
    openai: ['Open API keys in your OpenAI account.', 'Create a new secret key and copy it — it is shown only once.'],
    anthropic: ['Open API keys in the Anthropic console.', 'Create a key and copy it — it starts with sk-ant-.'],
};
