import {
    createProvider,
    PRESETS,
    ProviderError,
    type ChatRequest,
    type Provider,
    type RouterEntry,
    type StreamEvent,
    type Usage,
} from '@agentic/core';
import type { KeyRef, RouteStep } from './catalog';

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
    try {
        const models = await createProvider(preset, { apiKey: secret }).listModels(AbortSignal.timeout(15_000));
        return { state: 'valid', message: models.length ? `Verified · ${models.length} models available` : 'Verified' };
    } catch (err) {
        if (err instanceof ProviderError) {
            if (isAuthFailure(err)) {
                return { state: 'invalid', message: `${name} rejected this key. Check that you copied all of it.` };
            }
            if (err.kind === 'rate_limit') {
                return { state: 'valid', message: 'Key works, but it is rate-limited right now.' };
            }
        }
        const detail = err instanceof Error ? err.message.replace(/^\w+:\s*/, '').slice(0, 120) : String(err);
        return { state: 'unknown', message: `Couldn't reach ${name} to verify the key (${detail}). It will be checked on first use.` };
    }
}
