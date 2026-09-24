import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { store } from './kv';

/**
 * The password on the admin page.
 *
 * The password itself is never put in a URL or a cookie: signing in leaves a
 * cookie holding proof of it, derived with an HMAC keyed by the password, so
 * the cookie cannot be forged without knowing it and cannot be turned back
 * into it. Guesses are rate-limited per address.
 */

export const ADMIN_COOKIE = 'pb_admin';
const PROOF = 'admin-v1';
const MAX_ATTEMPTS = 10;
const WINDOW_SECONDS = 60 * 60;
const SESSION_SECONDS = 7 * 24 * 60 * 60;

export function adminPassword(): string | undefined {
    return (process.env.ADMIN_PASSWORD ?? process.env.ADMIN_TOKEN)?.trim() || undefined;
}

function proofFor(password: string): string {
    return createHmac('sha256', password).update(PROOF).digest('hex');
}

/** Compares without leaking, through timing, how much of the value matched. */
function same(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
}

export async function isSignedIn(): Promise<boolean> {
    const password = adminPassword();
    if (!password) {
        return false;
    }
    const cookie = (await cookies()).get(ADMIN_COOKIE)?.value;
    return !!cookie && same(cookie, proofFor(password));
}

/** The address, hashed: the raw one is never stored. */
async function addressKey(): Promise<string> {
    const list = await headers();
    const ip = list.get('x-forwarded-for')?.split(',')[0]?.trim() || list.get('x-real-ip') || 'unknown';
    return `pb:admintry:${createHash('sha256').update(ip).digest('hex').slice(0, 24)}`;
}

export type SignInResult = 'ok' | 'wrong' | 'locked' | 'unset';

export async function signIn(password: string): Promise<SignInResult> {
    const expected = adminPassword();
    if (!expected) {
        return 'unset';
    }
    const key = await addressKey();
    const tries = (await store.counts(key)).tries ?? 0;
    if (tries >= MAX_ATTEMPTS) {
        return 'locked';
    }
    if (!same(password, expected)) {
        await store.addCounts(key, { tries: 1 }, WINDOW_SECONDS);
        return 'wrong';
    }
    (await cookies()).set(ADMIN_COOKIE, proofFor(expected), {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: SESSION_SECONDS,
    });
    return 'ok';
}

export async function signOut(): Promise<void> {
    (await cookies()).delete(ADMIN_COOKIE);
}
