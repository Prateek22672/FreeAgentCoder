import type { QuotaWindow } from '../shared/protocol';

interface Partial {
    dimension: string;
    period?: string;
    limit?: number;
    remaining?: number;
    resetAt?: number;
}

const DIMENSION_ORDER = ['requests', 'tokens', 'input tokens', 'output tokens'];
const PERIOD_ORDER = ['minute', 'hour', 'day', 'month'];

/**
 * Reads the rate-limit headers providers attach to responses:
 * x-ratelimit-{limit,remaining,reset}[-requests|-tokens][-minute|-day|-month]
 * (Groq, OpenAI, Cerebras, Mistral, OpenRouter) and
 * anthropic-ratelimit-{requests,tokens,input-tokens,output-tokens}-{limit,remaining,reset}.
 */
export function parseQuotaHeaders(headers: Headers, now = Date.now()): QuotaWindow[] {
    const groups = new Map<string, Partial>();
    headers.forEach((value, rawName) => {
        const name = rawName.toLowerCase();
        let field: string;
        let dimension: string;
        let period: string | undefined;

        const generic = /^x-ratelimit-(limit|remaining|reset)(?:-([a-z-]+))?$/.exec(name);
        const anthropic = /^anthropic-ratelimit-([a-z-]+)-(limit|remaining|reset)$/.exec(name);
        if (generic) {
            field = generic[1];
            const [first = 'requests', ...rest] = (generic[2] ?? '').split('-').filter(Boolean);
            dimension = first === 'req' ? 'requests' : first;
            period = rest.join(' ') || undefined;
        } else if (anthropic) {
            field = anthropic[2];
            dimension = anthropic[1].replace(/-/g, ' ');
        } else {
            return;
        }

        const id = `${dimension}|${period ?? ''}`;
        const group = groups.get(id) ?? { dimension, period };
        groups.set(id, group);
        if (field === 'reset') {
            group.resetAt = parseReset(value, now);
        } else {
            const number = Number(value.trim());
            if (Number.isFinite(number)) {
                group[field === 'limit' ? 'limit' : 'remaining'] = number;
            }
        }
    });

    const windows: QuotaWindow[] = [];
    for (const group of groups.values()) {
        if (group.limit === undefined || group.remaining === undefined || group.limit <= 0) {
            continue;
        }
        windows.push({
            dimension: group.dimension,
            period: group.period,
            limit: group.limit,
            remaining: Math.max(0, Math.min(group.remaining, group.limit)),
            resetAt: group.resetAt,
        });
    }
    return windows.sort(
        (a, b) => rank(DIMENSION_ORDER, a.dimension) - rank(DIMENSION_ORDER, b.dimension) || rank(PERIOD_ORDER, a.period) - rank(PERIOD_ORDER, b.period),
    );
}

function rank(order: string[], value: string | undefined): number {
    const index = value === undefined ? -1 : order.indexOf(value);
    return index < 0 ? order.length : index;
}

function parseReset(value: string, now: number): number | undefined {
    const text = value.trim();
    if (/^\d+(\.\d+)?$/.test(text)) {
        const n = Number(text);
        if (n > 1e12) {
            return n;
        }
        if (n > 1e9) {
            return n * 1000;
        }
        return now + n * 1000;
    }
    const duration = parseDuration(text);
    if (duration !== undefined) {
        return now + duration;
    }
    const date = Date.parse(text);
    return Number.isNaN(date) ? undefined : date;
}

function parseDuration(text: string): number | undefined {
    const pattern = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
    let total = 0;
    let matched = false;
    for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
        matched = true;
        const n = Number(m[1]);
        total += m[2] === 'ms' ? n : m[2] === 's' ? n * 1000 : m[2] === 'm' ? n * 60_000 : n * 3_600_000;
    }
    return matched ? total : undefined;
}

/** The window closest to running out, for compact displays. */
export function tightestWindow(windows: QuotaWindow[]): QuotaWindow | undefined {
    return [...windows].sort((a, b) => a.remaining / a.limit - b.remaining / b.limit)[0];
}
