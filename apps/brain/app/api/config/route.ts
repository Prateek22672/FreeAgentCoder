import { NextResponse } from 'next/server';
import { readSpecialists } from '@/lib/specialists';
import { marketplaceStats } from '@/lib/marketplace';

export const runtime = 'nodejs';

/**
 * What the extension reads once a day: how each specialist is tuned. Public —
 * it is method instructions, nothing secret — and cached so a fleet of
 * extensions checking in costs almost nothing.
 */
export async function GET(): Promise<Response> {
    // The newest version on the Marketplace, so an out-of-date extension can say an update is out.
    const [specialists, market] = await Promise.all([readSpecialists(), marketplaceStats()]);
    return NextResponse.json(
        { specialists, latest: market?.version && market.version !== 'unknown' ? market.version : undefined },
        { headers: { 'cache-control': 'public, max-age=600, s-maxage=600' } },
    );
}
