/**
 * Every provider failure is normalized into one of these kinds, because the
 * router's recovery depends only on the kind: wait out a rate limit, skip a
 * provider whose free tier can't take a request this big, re-resolve a
 * retired model id, and so on.
 */
export type ProviderErrorKind =
  | 'rate_limit'
  | 'too_large'
  | 'auth'
  | 'model_not_found'
  | 'bad_tool_call'
  | 'server'
  | 'network'
  | 'bad_request'
  | 'refusal'
  | 'aborted';

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly provider?: string;

  constructor(
    message: string,
    kind: ProviderErrorKind,
    opts: { status?: number; retryAfterMs?: number; provider?: string } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
    this.provider = opts.provider;
  }
}

/** "7.66s", "2m59.5s", "250ms", "1h2m3s", "34" (seconds). */
export function parseDuration(text: string): number | undefined {
  const s = text.trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s) * 1000;
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  let total = 0;
  let matched = false;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    matched = true;
    const n = Number(m[1]);
    total += m[2] === 'ms' ? n : m[2] === 's' ? n * 1000 : m[2] === 'm' ? n * 60_000 : n * 3_600_000;
  }
  return matched ? total : undefined;
}

type HeaderBag = { get(name: string): string | null } | Record<string, string | undefined> | undefined;

function header(headers: HeaderBag, name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as { get?: unknown }).get === 'function') {
    return (headers as { get(n: string): string | null }).get(name) ?? undefined;
  }
  return (headers as Record<string, string | undefined>)[name];
}

export function retryAfterFrom(headers: HeaderBag, message: string): number | undefined {
  const ra = header(headers, 'retry-after');
  if (ra) {
    const n = Number(ra);
    if (Number.isFinite(n)) return n * 1000;
    const date = Date.parse(ra);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  const reset = header(headers, 'x-ratelimit-reset');
  if (reset) {
    const n = Number(reset);
    if (Number.isFinite(n)) {
      if (n > 1e12) return Math.max(0, n - Date.now()); // epoch ms (OpenRouter)
      if (n > 1e9) return Math.max(0, n * 1000 - Date.now()); // epoch s
      return n * 1000;
    }
  }
  for (const name of ['x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens']) {
    const v = header(headers, name);
    const d = v ? parseDuration(v) : undefined;
    if (d !== undefined) return d;
  }
  const m = /(?:try again|retry) in ([\d.]+\s*(?:ms|s|m|h|seconds?)?(?:[\d.]+s)?)/i.exec(message);
  if (m) return parseDuration(m[1]!.replace(/\s*seconds?/, 's').replace(/\s+/g, ''));
  return undefined;
}

export function classify(status: number, code: string, message: string): ProviderErrorKind {
  const m = message.toLowerCase();
  const c = code.toLowerCase();
  if (status === 401 || c.includes('invalid_api_key') || c === 'unauthenticated') return 'auth';
  if (
    status === 413 ||
    c.includes('context_length') ||
    /request too large|context length|context window|maximum context|too many tokens|prompt is too long|reduce the length|input is too long|exceeds the maximum/.test(m)
  ) {
    return 'too_large';
  }
  if (status === 429 || c.includes('rate_limit') || c === 'resource_exhausted') return 'rate_limit';
  if (status === 403) return /quota|rate limit/.test(m) ? 'rate_limit' : 'auth';
  if (
    c === 'tool_use_failed' ||
    /failed to call a function|tool call validation|failed_generation|invalid tool call|error parsing tool call|tool_use_failed/.test(m)
  ) {
    return 'bad_tool_call';
  }
  if (
    status === 404 ||
    c.includes('model_not_found') ||
    /model.{0,80}(not found|does not exist|decommissioned|deprecated|no longer (supported|available)|is not supported)|no such model|unknown model|invalid model/.test(m)
  ) {
    return 'model_not_found';
  }
  if (status >= 500 || status === 408) return 'server';
  return 'bad_request';
}

export async function errorFromResponse(res: Response, provider: string): Promise<ProviderError> {
  let body = '';
  try {
    body = await res.text();
  } catch {
    // body unreadable
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    json = undefined;
  }
  // Gemini's compat layer sometimes wraps the error in an array.
  const root = (Array.isArray(json) ? json[0] : json) as Record<string, unknown> | undefined;
  const err = (root?.error ?? root) as Record<string, unknown> | string | undefined;
  const message =
    (typeof err === 'string' ? err : (err?.message as string | undefined)) ??
    (root?.message as string | undefined) ??
    (root?.detail as string | undefined) ??
    (body.slice(0, 400) || res.statusText || `HTTP ${res.status}`);
  const code = typeof err === 'object' && err ? String(err.code ?? err.type ?? err.status ?? '') : '';
  const kind = classify(res.status, code, message);
  return new ProviderError(`${provider}: ${message}`, kind, {
    status: res.status,
    retryAfterMs: kind === 'rate_limit' ? retryAfterFrom(res.headers, message) : undefined,
    provider,
  });
}

/** Map a thrown fetch/stream error; a user abort always wins. */
export function toProviderError(err: unknown, provider: string, userSignal?: AbortSignal): ProviderError {
  if (userSignal?.aborted) return new ProviderError('aborted', 'aborted', { provider });
  if (err instanceof ProviderError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ProviderError(`${provider}: ${message}`, 'network', { provider });
}
