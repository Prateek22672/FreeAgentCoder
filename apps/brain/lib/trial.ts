/**
 * The free trial for Ask: a few questions a day on the site's own key, then
 * the visitor uses their own free key.
 *
 * Counted per visitor (an anonymous cookie) and per network address, so
 * clearing cookies does not reset it, with a higher allowance per address so
 * an office or campus sharing one IP is not locked out. A daily cap across
 * everyone protects the site's key from being drained.
 *
 * Best effort: counts live in this server's memory. On a multi-instance host
 * each instance counts separately, which errs in the visitor's favour.
 */
import 'server-only';
import { createHash, randomUUID } from 'node:crypto';

/** Enough to see whether it answers your codebase well; after that, a visitor brings their own free key. */
export const TRIAL_LIMIT = Math.max(0, Number(process.env.BRAIN_TRIAL_QUESTIONS ?? 2));
const PER_ADDRESS_LIMIT = TRIAL_LIMIT * 6;
const DAILY_CAP = Math.max(0, Number(process.env.BRAIN_TRIAL_DAILY_CAP ?? 200));
const DAY_MS = 24 * 60 * 60 * 1000;
export const VISITOR_COOKIE = 'pb_visitor';

interface Counter {
    count: number;
    since: number;
}

const store = globalThis as unknown as { __trial?: { visitors: Map<string, Counter>; addresses: Map<string, Counter>; day: Counter } };
const state = (store.__trial ??= { visitors: new Map(), addresses: new Map(), day: { count: 0, since: Date.now() } });

function current(map: Map<string, Counter>, key: string, now: number): Counter {
    const existing = map.get(key);
    if (existing && now - existing.since < DAY_MS) return existing;
    const fresh = { count: 0, since: now };
    map.set(key, fresh);
    if (map.size > 50_000) {
        for (const [k, v] of map) if (now - v.since >= DAY_MS) map.delete(k);
    }
    return fresh;
}

/** A network address, hashed: the raw IP is never kept. */
function addressOf(request: Request): string {
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const ip = forwarded || request.headers.get('x-real-ip') || 'unknown';
    return createHash('sha256').update(`${process.env.BRAIN_TRIAL_SALT ?? 'project-brain'}:${ip}`).digest('hex').slice(0, 32);
}

function visitorOf(request: Request): { id: string; isNew: boolean } {
    const cookie = request.headers.get('cookie') ?? '';
    const match = new RegExp(`(?:^|;\\s*)${VISITOR_COOKIE}=([a-f0-9-]{36})`).exec(cookie);
    return match?.[1] ? { id: match[1], isNew: false } : { id: randomUUID(), isNew: true };
}

export interface TrialStatus {
    limit: number;
    remaining: number;
    /** Set when the site's trial is unavailable for everyone today. */
    closed?: boolean;
    visitorId: string;
    setCookie?: string;
}

export function trialStatus(request: Request): TrialStatus {
    const now = Date.now();
    const visitor = visitorOf(request);
    const byVisitor = current(state.visitors, visitor.id, now);
    const byAddress = current(state.addresses, addressOf(request), now);
    if (now - state.day.since >= DAY_MS) state.day = { count: 0, since: now };

    const remaining = Math.max(0, Math.min(TRIAL_LIMIT - byVisitor.count, PER_ADDRESS_LIMIT - byAddress.count));
    return {
        limit: TRIAL_LIMIT,
        remaining: state.day.count >= DAILY_CAP ? 0 : remaining,
        ...(state.day.count >= DAILY_CAP ? { closed: true } : {}),
        visitorId: visitor.id,
        ...(visitor.isNew ? { setCookie: `${VISITOR_COOKIE}=${visitor.id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}` } : {}),
    };
}

/** Record one trial question. Call only after the status said one was left. */
export function useTrial(request: Request, visitorId: string): void {
    const now = Date.now();
    current(state.visitors, visitorId, now).count++;
    current(state.addresses, addressOf(request), now).count++;
    state.day.count++;
}

/** Give a question back when the answer failed through no fault of the visitor. */
export function refundTrial(request: Request, visitorId: string): void {
    const now = Date.now();
    const visitor = current(state.visitors, visitorId, now);
    const address = current(state.addresses, addressOf(request), now);
    visitor.count = Math.max(0, visitor.count - 1);
    address.count = Math.max(0, address.count - 1);
    state.day.count = Math.max(0, state.day.count - 1);
}
