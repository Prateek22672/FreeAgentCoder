import { AnthropicProvider, type Effort } from './anthropic';
import { OpenAICompatProvider } from './openai';
import type { Provider } from './types';

/**
 * Known providers. Free-tier facts were verified on 2026-09-11 and WILL drift:
 * providers retire models and change quotas often. When a model id stops
 * working the router asks the provider for its current list and picks the
 * closest match using `prefer`, so a stale default heals itself.
 */
export interface ProviderPreset {
  id: string;
  label: string;
  kind: 'openai' | 'anthropic';
  baseURL: string;
  /** Environment variables checked for the key, in order. */
  keyEnv: string[];
  needsKey: boolean;
  /** Free tier usable with just an API key. Paid providers are never auto-selected. */
  free: boolean;
  defaultModel: string;
  models: string[];
  /** Best-first patterns for picking a replacement when the default is retired. */
  prefer: RegExp[];
  contextWindow: number;
  /**
   * Largest request (input tokens) the FREE tier accepts in one call, e.g.
   * Groq's 8K tokens-per-minute cap rejects anything bigger outright. The
   * router routes bigger requests to a provider that can take them.
   */
  maxRequestTokens?: number;
  signupUrl: string;
  note: string;
  thoughtSignatures?: boolean;
  maxTokensParam?: 'max_tokens' | 'max_completion_tokens';
  headers?: Record<string, string>;
}

export const PRESETS: Record<string, ProviderPreset> = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'openai',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    needsKey: true,
    free: true,
    defaultModel: 'gemini-3.8-flash',
    models: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'],
    prefer: [/^gemini-[\d.]+-flash$/, /^gemini-[\d.]+-flash-lite$/, /^gemini-.*flash/],
    contextWindow: 1_048_576,
    maxRequestTokens: 200_000,
    signupUrl: 'https://aistudio.google.com/apikey',
    note: 'Free tier, 1M-token context, strong at agentic coding. Daily request quota applies.',
    thoughtSignatures: true,
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    kind: 'openai',
    baseURL: 'https://api.groq.com/openai/v1',
    keyEnv: ['GROQ_API_KEY'],
    needsKey: true,
    free: true,
    defaultModel: 'openai/gpt-oss-120b',
    models: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'qwen/qwen3.6-27b', 'openai/gpt-oss-20b'],
    prefer: [/gpt-oss-120b/, /qwen.*coder/, /qwen3\.\d+/, /gpt-oss/],
    contextWindow: 131_072,
    maxRequestTokens: 6_500,
    signupUrl: 'https://console.groq.com/keys',
    note: 'Very fast. The free tier allows only ~8K tokens per minute, so it handles small requests and bigger ones go elsewhere.',
    maxTokensParam: 'max_completion_tokens',
  },
  cerebras: {
    id: 'cerebras',
    label: 'Cerebras',
    kind: 'openai',
    baseURL: 'https://api.cerebras.ai/v1',
    keyEnv: ['CEREBRAS_API_KEY'],
    needsKey: true,
    free: true,
    defaultModel: 'gpt-oss-120b',
    models: ['gpt-oss-120b', 'qwen-3.8-27b'],
    prefer: [/gpt-oss-120b/, /qwen.*coder/, /qwen/, /gpt-oss/],
    contextWindow: 65_536,
    maxRequestTokens: 28_000,
    signupUrl: 'https://cloud.cerebras.ai',
    note: 'Free tier: 1M tokens/day but only 5 requests/minute and a 64K context.',
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    kind: 'openai',
    baseURL: 'https://api.mistral.ai/v1',
    keyEnv: ['MISTRAL_API_KEY'],
    needsKey: true,
    free: true,
    defaultModel: 'mistral-medium-latest',
    models: ['mistral-medium-latest', 'codestral-latest', 'mistral-small-latest', 'mistral-large-latest'],
    prefer: [/^mistral-medium/, /^codestral/, /^mistral-large/, /^mistral-small/],
    contextWindow: 128_000,
    signupUrl: 'https://console.mistral.ai/api-keys',
    note: 'Free "Experiment" plan (phone verification). Rate-limited but generous monthly tokens.',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter (free models)',
    kind: 'openai',
    baseURL: 'https://openrouter.ai/api/v1',
    keyEnv: ['OPENROUTER_API_KEY'],
    needsKey: true,
    free: true,
    defaultModel: 'openrouter/free',
    models: ['openrouter/free', 'nex-agi/nex-n2.5-pro:free', 'poolside/laguna-xs-2.1:free', 'cohere/north-mini-code:free'],
    prefer: [/^openrouter\/free$/, /:free$/],
    contextWindow: 131_072,
    signupUrl: 'https://openrouter.ai/keys',
    note: '"openrouter/free" routes to whichever free model is available. 50 requests/day (1,000/day after a one-time $10 top-up).',
    headers: { 'HTTP-Referer': 'https://github.com/agentic-dev/agentic', 'X-Title': 'Agentic' },
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    kind: 'openai',
    baseURL: 'http://localhost:11434/v1',
    keyEnv: [],
    needsKey: false,
    free: true,
    defaultModel: 'qwen3-coder:30b',
    models: ['qwen3-coder:30b', 'qwen3.6:27b-coding', 'devstral-small-2:24b', 'gpt-oss:20b'],
    prefer: [/qwen.*cod/, /devstral/, /gpt-oss/, /qwen3/, /llama3\.[1-9]/, /./],
    contextWindow: 32_768,
    signupUrl: 'https://ollama.com/download',
    note: 'Runs on your machine, fully private, no limits. Needs a strong GPU for coding models; start it with OLLAMA_CONTEXT_LENGTH=32768.',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI (paid)',
    kind: 'openai',
    baseURL: 'https://api.openai.com/v1',
    keyEnv: ['OPENAI_API_KEY'],
    needsKey: true,
    free: false,
    defaultModel: 'gpt-5',
    models: ['gpt-5', 'gpt-5-mini'],
    prefer: [/^gpt-5(\.\d+)?$/, /^gpt-5/],
    contextWindow: 272_000,
    signupUrl: 'https://platform.openai.com/api-keys',
    note: 'Paid, bring your own key.',
    maxTokensParam: 'max_completion_tokens',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic Claude (paid)',
    kind: 'anthropic',
    baseURL: 'https://api.anthropic.com',
    keyEnv: ['ANTHROPIC_API_KEY'],
    needsKey: true,
    free: false,
    defaultModel: 'claude-opus-5',
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    prefer: [/^claude-opus-5/, /^claude-sonnet-5/, /^claude-opus/, /^claude-sonnet/],
    contextWindow: 1_000_000,
    signupUrl: 'https://platform.claude.com/settings/keys',
    note: 'Paid, bring your own key. The strongest option for long, multi-file tasks.',
  },
};

/** Order used to build the automatic free fallback chain. */
export const FREE_ORDER = ['gemini', 'cerebras', 'groq', 'mistral', 'openrouter', 'ollama'];

export interface ModelRef {
  provider: string;
  model: string;
}

/** "groq:openai/gpt-oss-120b" → { provider: "groq", model: "openai/gpt-oss-120b" }. A bare preset id means its default model. */
export function parseModelRef(ref: string, presets: Record<string, ProviderPreset> = PRESETS): ModelRef {
  const trimmed = ref.trim();
  const colon = trimmed.indexOf(':');
  if (colon > 0) {
    const provider = trimmed.slice(0, colon).toLowerCase();
    if (presets[provider] || provider === 'custom') return { provider, model: trimmed.slice(colon + 1) };
  }
  if (presets[trimmed.toLowerCase()]) {
    const preset = presets[trimmed.toLowerCase()]!;
    return { provider: preset.id, model: preset.defaultModel };
  }
  for (const preset of Object.values(presets)) {
    if (preset.models.includes(trimmed)) return { provider: preset.id, model: trimmed };
  }
  throw new Error(`Unknown model "${ref}". Use provider:model, e.g. gemini:gemini-3.8-flash or groq:openai/gpt-oss-120b.`);
}

export function formatModelRef(ref: ModelRef): string {
  return `${ref.provider}:${ref.model}`;
}

export interface ProviderOptions {
  apiKey?: string;
  baseURL?: string;
  /** Browser builds call providers directly with the user's key. */
  browser?: boolean;
  effort?: Effort;
  maxOutputTokens?: number;
  /** Sees the HTTP response headers of each request (rate-limit dashboards). */
  onHeaders?: (headers: Headers) => void;
  /** Override image-input detection (default: `modelSupportsImages(preset.id, model)`). */
  supportsImages?: boolean | ((model: string) => boolean);
}

export function createProvider(preset: ProviderPreset, opts: ProviderOptions = {}): Provider {
  if (preset.kind === 'anthropic') {
    return new AnthropicProvider({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      browser: opts.browser,
      effort: opts.effort,
      maxOutputTokens: opts.maxOutputTokens,
      onHeaders: opts.onHeaders,
      supportsImages: opts.supportsImages,
    });
  }
  return new OpenAICompatProvider({
    id: preset.id,
    baseURL: opts.baseURL ?? preset.baseURL,
    apiKey: opts.apiKey,
    headers: preset.headers,
    thoughtSignatures: preset.thoughtSignatures,
    maxTokensParam: preset.maxTokensParam,
    maxOutputTokens: opts.maxOutputTokens,
    onHeaders: opts.onHeaders,
    supportsImages: opts.supportsImages,
  });
}

/**
 * Pick the best model from a provider's live list. Patterns are tried in
 * order; within a pattern, the highest version number wins
 * ("gemini-3.8-flash" beats "gemini-3.5-flash").
 */
export function pickModel(available: string[], prefer: RegExp[]): string | undefined {
  for (const pattern of prefer) {
    const hits = available.filter((m) => pattern.test(m));
    if (hits.length) return hits.sort(compareVersionsDesc)[0];
  }
  return undefined;
}

function compareVersionsDesc(a: string, b: string): number {
  const va = (a.match(/\d+(\.\d+)*/)?.[0] ?? '0').split('.').map(Number);
  const vb = (b.match(/\d+(\.\d+)*/)?.[0] ?? '0').split('.').map(Number);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const d = (vb[i] ?? 0) - (va[i] ?? 0);
    if (d) return d;
  }
  return a.length - b.length;
}
