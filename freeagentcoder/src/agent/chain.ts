import {
    createProvider,
    OpenAICompatProvider,
    PRESETS,
    ProviderError,
    type ChatRequest,
    type Provider,
    type RouterEntry,
    type StreamEvent,
    type Usage,
} from '@agentic/core';
import type { KeyRef, RouteStep } from './catalog';
import { TRIAL_PROVIDER, TRIAL_URL } from '../shared/site';

export interface RoutableKey extends KeyRef {
    secret: string;
}

export interface CallResult {
    ok: boolean;
    model: string;
    /** From sending the request to the end of the reply. */
    latencyMs: number;
    usage?: Usage;
    error?: ProviderError;
}

export interface ChainHooks {
    onAttempt(key: RoutableKey, model: string): void;
    onResult(key: RoutableKey, result: CallResult): void;
    onHeaders(key: RoutableKey, headers: Headers): void;
}

/** Reports each call to the key it was made with; the router still sees the real provider. */
class TrackedProvider implements Provider {
    constructor(
        private readonly inner: Provider,
        private readonly key: RoutableKey,
        private readonly hooks: ChainHooks,
    ) {}

    get id(): string {
        return this.inner.id;
    }

    listModels(signal?: AbortSignal): Promise<string[]> {
        return this.inner.listModels(signal);
    }

    async *stream(req: ChatRequest): AsyncGenerator<StreamEvent> {
        this.hooks.onAttempt(this.key, req.model);
        const started = Date.now();
        let usage: Usage | undefined;
        let finished = false;
        let failure: unknown;
        try {
            for await (const event of this.inner.stream(req)) {
                if (event.type === 'usage') {
                    usage = event.usage;
                }
                if (event.type === 'done') {
                    finished = true;
                }
                yield event;
            }
        } catch (error) {
            failure = error;
            throw error;
        } finally {
            const timing = { model: req.model, latencyMs: Date.now() - started };
            if (req.signal?.aborted) {
                // Stopped by the user: not the key's fault, nothing to record.
            } else if (failure !== undefined) {
                const error = failure instanceof ProviderError ? failure : new ProviderError(String((failure as Error)?.message ?? failure), 'network');
                if (error.kind !== 'aborted') {
                    this.hooks.onResult(this.key, { ok: false, usage, error, ...timing });
                }
            } else {
                this.hooks.onResult(
                    this.key,
                    finished ? { ok: true, usage, ...timing } : { ok: false, usage, error: new ProviderError('stream ended early', 'network'), ...timing },
                );
            }
        }
    }
}

/**
 * Turns route steps into router entries, one per key. Entries are cached so
 * the router's cooldowns and learned size limits survive between requests.
 */
export class ChainBuilder {
    private readonly cache = new Map<string, RouterEntry>();

    constructor(private readonly hooks: ChainHooks) {}

    build(steps: RouteStep<RoutableKey>[]): RouterEntry[] {
        return steps.flatMap((step) => step.keys.map((key) => this.entry(key, step.model)));
    }

    forget(keyId: string): void {
        for (const cacheKey of [...this.cache.keys()]) {
            if (cacheKey.startsWith(`${keyId}|`)) {
                this.cache.delete(cacheKey);
            }
        }
    }

    private entry(key: RoutableKey, model: string): RouterEntry {
        const cacheKey = `${key.id}|${model}|${key.secret.length}:${key.secret.slice(-6)}`;
        const cached = this.cache.get(cacheKey);
        if (cached) {
            cached.label = key.label;
            return cached;
        }
        if (key.provider === TRIAL_PROVIDER) {
            const entry = this.trialEntry(key, model);
            this.cache.set(cacheKey, entry);
            return entry;
        }
        const preset = PRESETS[key.provider];
        const inner = createProvider(preset, {
            apiKey: key.secret,
            onHeaders: (headers) => this.hooks.onHeaders(key, headers),
        });
        const entry: RouterEntry = {
            provider: new TrackedProvider(inner, key, this.hooks),
            model,
            contextWindow: preset.contextWindow,
            maxRequestTokens: preset.maxRequestTokens,
            prefer: preset.prefer,
            label: key.label,
        };
        this.cache.set(cacheKey, entry);
        return entry;
    }

    /**
     * The free trial: OpenAI-compatible, with Gemini's thought signatures passed
     * through, since the server may answer with Gemini. It reads no images; the
     * extension reads them on this computer first.
     */
    private trialEntry(key: RoutableKey, model: string): RouterEntry {
        const inner = new OpenAICompatProvider({
            id: TRIAL_PROVIDER,
            baseURL: TRIAL_URL,
            apiKey: key.secret,
            thoughtSignatures: true,
            reasoningEffort: true,
            supportsImages: false,
            maxOutputTokens: 8_192,
            onHeaders: (headers) => this.hooks.onHeaders(key, headers),
        });
        return {
            provider: new TrackedProvider(inner, key, this.hooks),
            model,
            contextWindow: 128_000,
            label: key.label,
        };
    }
}

export function isAuthFailure(error: ProviderError): boolean {
    return (
        error.kind === 'auth' ||
        /api key not valid|invalid api key|api_key_invalid|incorrect api key|invalid x-api-key|unauthori[sz]ed|authentication/i.test(error.message)
    );
}

export async function verifyKey(provider: string, secret: string): Promise<{ state: 'valid' | 'invalid' | 'unknown'; message: string }> {
    const preset = PRESETS[provider];
    const name = preset?.label ?? provider;
    if (!preset) {
        return { state: 'invalid', message: `Unknown provider "${provider}".` };
    }
    if (!preset.free && provider === 'cerebras') {
        return { state: 'invalid', message: 'Cerebras keys need a paid account now, so FreeAgentCoder no longer uses them. Add a free Gemini, Groq or OpenRouter key instead.' };
    }
    try {
        const client = createProvider(preset, { apiKey: secret, maxOutputTokens: 1 });
        const models = await client.listModels(AbortSignal.timeout(15_000));
        // A key can list models and still be refused every answer (no plan, no credit), so ask for one token.
        for await (const event of client.stream({ model: preset.defaultModel, system: 'Reply with one word.', messages: [{ role: 'user', content: 'hi' }], tools: [], signal: AbortSignal.timeout(20_000) })) {
            if (event.type === 'done') {
                break;
            }
        }
        return { state: 'valid', message: models.length ? `Verified: it answered a test request · ${models.length} models available` : 'Verified: it answered a test request' };
    } catch (err) {
        if (err instanceof ProviderError) {
            if (needsBilling(err)) {
                return { state: 'invalid', message: billingMessage(provider, name) };
            }
            if (isAuthFailure(err)) {
                return { state: 'invalid', message: `${name} rejected this key. Check that you copied all of it. A key found online will not work: providers cancel shared keys, so make your own (free, about a minute).` };
            }
            if (err.kind === 'rate_limit') {
                return { state: 'valid', message: 'Key works, but it is rate-limited right now.' };
            }
        }
        const detail = err instanceof Error ? err.message.replace(/^\w+:\s*/, '').slice(0, 120) : String(err);
        return { state: 'unknown', message: `Couldn't reach ${name} to verify the key (${detail}). It will be checked on first use.` };
    }
}

/** The key is real, but its account cannot answer: no plan chosen, no credit, billing required. */
export function needsBilling(error: ProviderError): boolean {
    return /\b(billing|payment|insufficient[_ ](balance|credit|funds|quota)|credit balance|no credits?|out of credits|subscription|activate|upgrade your plan|plan (is )?(required|inactive)|402)\b/i.test(error.message) || error.status === 402;
}

export function billingMessage(provider: string, name: string): string {
    switch (provider) {
        case 'mistral':
            return 'Mistral accepted this key but will not answer with it: the account has no active plan. In console.mistral.ai, choose the free Experiment plan (it asks to verify a phone number), or use a free Gemini, Groq or OpenRouter key instead.';
        case 'openrouter':
            return 'OpenRouter accepted this key but refused a request for lack of credit. Free models (ending in :free) need no credit; if this keeps happening, check the key has no spending limit of $0 set.';
        default:
            return `${name} accepted this key but its account needs billing before it answers. Use a free Gemini, Groq or OpenRouter key instead, or add billing at ${name}.`;
    }
}
