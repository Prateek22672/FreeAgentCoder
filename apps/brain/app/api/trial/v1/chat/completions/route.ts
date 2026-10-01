import { poolTargets, recordPoolCall, type PoolTarget } from '@/lib/keypool';
import { addressFrom, allowance, charge, installFrom, note, readExtTrialSettings } from '@/lib/extTrial';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * The extension's free trial: an OpenAI-compatible chat endpoint backed by the
 * site's key pool. The extension sends its usual request with model "fast" or
 * "deep"; this picks a pool key that suits the size and kind of the request,
 * fails over to the next on a limit or an outage, streams the answer back, and
 * counts it against the install's daily allowance.
 *
 * Nothing is stored but counts: the request and the answer pass through.
 */

/** The model each provider runs for a fast or a deep step. */
const MODELS: Record<string, { fast: string; deep: string }> = {
    gemini: { fast: 'gemini-3.5-flash-lite', deep: 'gemini-3.8-flash' },
    groq: { fast: 'openai/gpt-oss-120b', deep: 'openai/gpt-oss-120b' },
    mistral: { fast: 'mistral-small-latest', deep: 'mistral-medium-latest' },
    openrouter: { fast: 'openrouter/free', deep: 'openrouter/free' },
    openai: { fast: 'gpt-5-mini', deep: 'gpt-5' },
};
const ORDER = {
    fast: ['groq', 'gemini', 'openrouter', 'mistral', 'openai'],
    deep: ['gemini', 'openrouter', 'mistral', 'groq', 'openai'],
};
const MAX_BODY = 2_000_000;
const MAX_OUTPUT = 8_192;
const MAX_ATTEMPTS = 4;

function error(message: string, status: number, code: string): Response {
    return new Response(JSON.stringify({ error: { message, code, type: code } }), { status, headers: { 'content-type': 'application/json' } });
}

/** Keys in the order to try: by provider for the tier, least used first, and only those whose free tier takes a request this size. */
function plan(targets: PoolTarget[], tier: 'fast' | 'deep', size: number): PoolTarget[] {
    return ORDER[tier].flatMap((provider) =>
        targets
            .filter((t) => t.provider === provider && MODELS[provider] && size <= Math.min(t.maxRequestTokens ?? Infinity, t.contextWindow * 0.9))
            .sort((a, b) => a.usedToday - b.usedToday),
    );
}

/** The request as this provider wants it: its own model, its own output-limit field, and no Gemini-only fields elsewhere. */
function bodyFor(target: PoolTarget, body: Record<string, unknown>, tier: 'fast' | 'deep'): string {
    const out: Record<string, unknown> = { ...body, model: MODELS[target.provider]![tier], stream: true, stream_options: { include_usage: true } };
    const asked = Number(out.max_tokens ?? out.max_completion_tokens) || MAX_OUTPUT;
    delete out.max_tokens;
    delete out.max_completion_tokens;
    out[target.maxTokensParam] = Math.min(asked, MAX_OUTPUT);
    if (!target.thoughtSignatures && Array.isArray(out.messages)) {
        out.messages = (out.messages as Record<string, unknown>[]).map((m) =>
            Array.isArray(m.tool_calls) ? { ...m, tool_calls: (m.tool_calls as Record<string, unknown>[]).map(({ extra_content: _drop, ...call }) => call) } : m,
        );
    }
    return JSON.stringify(out);
}

/** A failure worth handing to the next key, rather than back to the extension. */
const retryable = (status: number, text: string) =>
    status === 429 || status === 401 || status === 403 || status === 404 || status === 413 || status >= 500 || /too large|context length|maximum context|too many tokens|rate limit|quota/i.test(text);

export async function POST(request: Request): Promise<Response> {
    const install = installFrom(request);
    if (!install) return error('This endpoint is for the FreeAgentCoder extension’s free trial.', 401, 'invalid_api_key');
    const settings = await readExtTrialSettings();
    const address = addressFrom(request);
    const allowed = await allowance(install, address, settings);
    if (!allowed.ok) {
        void note(allowed.code === 'trial_off' ? 'refused_off' : allowed.code === 'trial_closed' ? 'refused_closed' : 'refused_limit', install);
        // 429 with "per day" in the message: the extension sets the trial aside until tomorrow instead of retrying.
        return error(allowed.reason!, 429, allowed.code!);
    }

    const text = await request.text();
    if (text.length > MAX_BODY) return error('Request too large for the free trial.', 413, 'context_length_exceeded');
    let body: Record<string, unknown>;
    try {
        body = JSON.parse(text) as Record<string, unknown>;
    } catch {
        return error('Not a valid request.', 400, 'invalid_request');
    }
    const tier = body.model === 'fast' ? 'fast' : 'deep';
    const size = Math.ceil(text.length / 4);
    const order = plan(await poolTargets(), tier, size);
    if (!order.length) {
        void note('failed', install);
        // Said as "too large" when keys exist but none takes a request this size, so the extension compacts and retries.
        return size > 6_000
            ? error('Request too large for the free trial’s models. Maximum context exceeded.', 413, 'context_length_exceeded')
            : error('The free trial has no model available right now. Try again in a minute, or add your own free key.', 503, 'trial_unavailable');
    }

    let last: { status: number; text: string } | undefined;
    for (const target of order.slice(0, MAX_ATTEMPTS)) {
        let upstream: Response;
        try {
            upstream = await fetch(`${target.baseURL}/chat/completions`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${target.apiKey}`, ...target.headers },
                body: bodyFor(target, body, tier),
                signal: AbortSignal.any([request.signal, AbortSignal.timeout(55_000)]),
            });
        } catch {
            if (request.signal.aborted) return error('Cancelled.', 499, 'aborted');
            void recordPoolCall(target.id, false);
            last = { status: 502, text: `${target.provider} could not be reached` };
            continue;
        }
        if (!upstream.ok || !upstream.body) {
            const detail = (await upstream.text().catch(() => '')).slice(0, 300);
            if (retryable(upstream.status, detail)) {
                void recordPoolCall(target.id, false);
                last = { status: upstream.status, text: detail };
                continue;
            }
            // The request itself was refused (a malformed tool call, say): the extension handles that best.
            return new Response(detail || JSON.stringify({ error: { message: `HTTP ${upstream.status}` } }), {
                status: upstream.status,
                headers: { 'content-type': 'application/json' },
            });
        }
        return relay(upstream.body, { install, address, provider: target.provider, id: target.id, promptTokens: size, left: allowed.requestsLeft - 1, limit: allowed.limit });
    }

    void note('failed', install);
    const busy = last?.status === 429;
    return error(
        busy ? 'The free trial’s models are busy right now. Try again in a minute, or add your own free key.' : `The free trial could not get an answer (${last?.text || 'no model answered'}).`,
        busy ? 429 : 502,
        busy ? 'rate_limit_exceeded' : 'trial_upstream',
    );
}

/** Streams the answer through unchanged, reading the token count on the way, and charges the install when it ends. */
function relay(
    stream: ReadableStream<Uint8Array>,
    ctx: { install: string; address: string; provider: string; id: string; promptTokens: number; left: number; limit: number },
): Response {
    const decoder = new TextDecoder();
    let tail = '';
    let reported = 0;
    let chars = 0;
    let settled = false;
    const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        void recordPoolCall(ctx.id, ok);
        if (ok) void charge(ctx.install, ctx.address, reported || ctx.promptTokens + Math.ceil(chars / 4), ctx.provider);
        else void note('failed', ctx.install);
    };
    const counted = stream.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
                controller.enqueue(chunk);
                const text = tail + decoder.decode(chunk, { stream: true });
                const lines = text.split('\n');
                tail = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.startsWith('data:')) continue;
                    chars += line.length;
                    const total = /"total_tokens"\s*:\s*(\d+)/.exec(line);
                    if (total) reported = Number(total[1]);
                }
            },
            flush() {
                settle(true);
            },
        }),
    );
    // A cancelled stream (Stop pressed, or a dropped connection) still counts the call.
    const reader = counted.getReader();
    const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const { done, value } = await reader.read();
                if (done) controller.close();
                else controller.enqueue(value);
            } catch (err) {
                settle(false);
                controller.error(err);
            }
        },
        cancel(reason) {
            settle(chars > 0);
            void reader.cancel(reason);
        },
    });
    return new Response(body, {
        headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store',
            'x-trial-provider': ctx.provider,
            'x-ratelimit-limit-requests-day': String(ctx.limit),
            'x-ratelimit-remaining-requests-day': String(Math.max(0, ctx.left)),
        },
    });
}
