'use server';

import { revalidatePath } from 'next/cache';
import { isSignedIn } from '@/lib/admin';
import { NO_STORE_MESSAGE } from '@/lib/kv';
import { writePlans } from '@/lib/plans';

export interface PlansState {
    error?: string;
    saved?: boolean;
}

/** Saves the paid tier's settings. Refuses anyone not signed in to the admin page. */
export async function savePlansAction(_state: PlansState | undefined, form: FormData): Promise<PlansState> {
    if (!(await isSignedIn())) {
        return { error: 'Sign in first.' };
    }
    const result = await writePlans({
        enabled: form.get('enabled') === 'on',
        priceLabel: String(form.get('priceLabel') ?? ''),
        weeklyTokens: Number(form.get('weeklyTokens') ?? 0),
        checkoutUrl: String(form.get('checkoutUrl') ?? ''),
        note: String(form.get('note') ?? ''),
    });
    if ('problem' in result) {
        return {
            error:
                result.problem === 'no-store'
                    ? NO_STORE_MESSAGE
                    : result.problem === 'checkout-url'
                      ? 'The checkout link must start with https://.'
                      : 'The weekly quota must be a number of tokens, zero or more.',
        };
    }
    revalidatePath('/admin');
    return { saved: true };
}
