import 'server-only';
import { NextResponse } from 'next/server';
import { RepoError } from './github';
import { getBrain, type Brain } from './store';

export function json(data: unknown, status = 200): NextResponse {
    return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function fail(message: string, status = 400, extra: Record<string, unknown> = {}): NextResponse {
    return json({ error: message, ...extra }, status);
}

/** Map anything thrown to a response without leaking internals or tokens. */
export function failFrom(error: unknown): NextResponse {
    if (error instanceof RepoError) return fail(error.message, error.status);
    console.error('[brain]', error instanceof Error ? error.message : error);
    return fail('Something went wrong while analyzing this repository.', 500);
}

export async function readBody<T>(request: Request): Promise<T | undefined> {
    try {
        return (await request.json()) as T;
    } catch {
        return undefined;
    }
}

/** A brain that expired returns 410 so the client can re-analyze silently. */
export function requireBrain(id: unknown): Brain | NextResponse {
    if (typeof id !== 'string' || !id) return fail('Missing repository id.');
    return getBrain(id) ?? fail('This analysis expired. Analyzing again…', 410, { expired: true });
}

export function isResponse(value: unknown): value is NextResponse {
    return value instanceof NextResponse;
}
