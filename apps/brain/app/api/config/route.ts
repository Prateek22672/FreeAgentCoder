import { NextResponse } from 'next/server';
import { readSpecialists } from '@/lib/specialists';
import { marketplaceStats } from '@/lib/marketplace';
import { publicReferences } from '@/lib/references';

export const runtime = 'nodejs';

/**
 * What the extension reads once a day: how each specialist is tuned, and the
 * reference library it matches tasks against on the user's machine. Public —
 * it is method instructions, nothing secret — and cached so a fleet of
 * extensions checking in costs almost nothing.
 */
export async function GET(): Promise<Response> {
    // The newest version on the Marketplace, so an out-of-date extension can say an update is out.
    const [specialists, market, references] = await Promise.all([readSpecialists(), marketplaceStats(), publicReferences()]);
    return NextResponse.json(
        { specialists, references, latest: market?.version && market.version !== 'unknown' ? market.version : undefined },
        { headers: { 'cache-control': 'public, max-age=600, s-maxage=600' } },
    );
}
