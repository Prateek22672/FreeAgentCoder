import { NextResponse } from 'next/server';
import { readSpecialists } from '@/lib/specialists';

export const runtime = 'nodejs';

/**
 * What the extension reads once a day: how each specialist is tuned. Public —
 * it is method instructions, nothing secret — and cached so a fleet of
 * extensions checking in costs almost nothing.
 */
export async function GET(): Promise<Response> {
    return NextResponse.json({ specialists: await readSpecialists() }, { headers: { 'cache-control': 'public, max-age=600, s-maxage=600' } });
}
