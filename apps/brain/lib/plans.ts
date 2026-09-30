import 'server-only';
import { store } from './kv';

/**
 * The paid tier, as the admin page configures it and the extension reads it.
 *
 * Off until switched on here. The extension asks for this only when someone
 * opens its Plans page — never on startup — so the free tier keeps making no
 * calls to this site at all. Nothing here is a secret: it is what a visitor to
 * the checkout page would see anyway.
 */

export interface Plans {
    enabled: boolean;
    /** Shown as written, e.g. "₹299 a month". The extension never computes with it. */
    priceLabel: string;
    /** What a licence buys per week, in model tokens. Zero means unset. */
    weeklyTokens: number;
    /** Where "Get a licence" sends someone: a Razorpay payment link. https only. */
    checkoutUrl: string;
    /** One line under the paid tier, e.g. what happens after paying. */
    note: string;
    updatedAt: number;
}

const KEY = 'pb:plans';
const TEN_YEARS = 10 * 365 * 24 * 60 * 60;

export const DEFAULT_PLANS: Plans = { enabled: false, priceLabel: '', weeklyTokens: 0, checkoutUrl: '', note: '', updatedAt: 0 };

export async function readPlans(): Promise<Plans> {
    const [raw] = await store.getMany([KEY]);
    if (!raw) {
        return DEFAULT_PLANS;
    }
    try {
        return { ...DEFAULT_PLANS, ...(JSON.parse(raw) as Partial<Plans>) };
    } catch {
        return DEFAULT_PLANS;
    }
}

export type PlansProblem = 'checkout-url' | 'quota';

/** Validates and saves. A bad field is refused rather than saved half-right. */
export async function writePlans(input: Partial<Plans>): Promise<{ plans: Plans } | { problem: PlansProblem }> {
    const current = await readPlans();
    const checkoutUrl = (input.checkoutUrl ?? current.checkoutUrl).trim();
    if (checkoutUrl && !/^https:\/\/[^\s]+$/i.test(checkoutUrl)) {
        return { problem: 'checkout-url' };
    }
    const weeklyTokens = Math.round(Number(input.weeklyTokens ?? current.weeklyTokens));
    if (!Number.isFinite(weeklyTokens) || weeklyTokens < 0) {
        return { problem: 'quota' };
    }
    const plans: Plans = {
        enabled: Boolean(input.enabled ?? current.enabled),
        priceLabel: String(input.priceLabel ?? current.priceLabel).trim().slice(0, 40),
        weeklyTokens,
        checkoutUrl,
        note: String(input.note ?? current.note).trim().slice(0, 200),
        updatedAt: Date.now(),
    };
    await store.put(KEY, JSON.stringify(plans), TEN_YEARS);
    return { plans };
}
