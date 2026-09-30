import { NextResponse } from 'next/server';
import { readPlans } from '@/lib/plans';

export const runtime = 'nodejs';

/**
 * What the extension shows on its Plans page. Public, since it is what the
 * checkout page shows anyway, and cached for a few minutes so a switch flipped
 * on the admin page reaches everyone soon without every open panel hitting
 * the store.
 */
export async function GET(): Promise<Response> {
    const plans = await readPlans();
    return NextResponse.json(
        {
            enabled: plans.enabled,
            priceLabel: plans.priceLabel,
            weeklyTokens: plans.weeklyTokens,
            checkoutUrl: plans.checkoutUrl,
            note: plans.note,
        },
        { headers: { 'cache-control': 'public, max-age=300, s-maxage=300' } },
    );
}
