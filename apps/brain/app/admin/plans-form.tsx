'use client';

import { useActionState } from 'react';
import type { Plans } from '@/lib/plans';
import { savePlansAction, type PlansState } from './plans-actions';

const field = 'h-10 w-full rounded-md border border-line-strong bg-panel px-3 text-[14px] text-fg outline-none placeholder:text-faint focus:border-accent';
const label = 'block text-[11px] font-semibold uppercase tracking-wide text-muted';

export function PlansForm({ plans }: { plans: Plans }) {
    const [state, action, pending] = useActionState<PlansState | undefined, FormData>(savePlansAction, undefined);

    return (
        <form action={action} className="col-span-full grid gap-4 rounded-lg border border-line bg-panel p-4 sm:grid-cols-2">
            <label className="col-span-full flex items-center gap-3 text-[14px] text-fg">
                <input type="checkbox" name="enabled" defaultChecked={plans.enabled} className="size-4 accent-[var(--accent)]" />
                <span>
                    <span className="font-medium">Paid tier is on</span>
                    <span className="block text-[12px] text-muted">
                        Off: the extension&rsquo;s Plans page shows only the free tier. On: it shows the price, the weekly quota and a button to the checkout link below.
                    </span>
                </span>
            </label>
            <div>
                <span className={label}>Price, as shown</span>
                <input name="priceLabel" defaultValue={plans.priceLabel} placeholder="₹299 a month" maxLength={40} className={`${field} mt-1`} />
            </div>
            <div>
                <span className={label}>Weekly quota, in tokens</span>
                <input name="weeklyTokens" type="number" min={0} step={100000} defaultValue={plans.weeklyTokens || ''} placeholder="5000000" className={`${field} mt-1`} />
            </div>
            <div className="col-span-full">
                <span className={label}>Checkout link (Razorpay payment link)</span>
                <input name="checkoutUrl" defaultValue={plans.checkoutUrl} placeholder="https://rzp.io/l/…" className={`${field} mt-1`} />
            </div>
            <div className="col-span-full">
                <span className={label}>One line under the paid tier</span>
                <input name="note" defaultValue={plans.note} placeholder="Your licence key is emailed within a minute of paying." maxLength={200} className={`${field} mt-1`} />
            </div>
            <div className="col-span-full flex items-center gap-3">
                <button type="submit" disabled={pending} className="h-10 rounded-md bg-accent px-4 text-[14px] font-semibold text-accent-fg hover:brightness-110 disabled:opacity-60">
                    {pending ? 'Saving…' : 'Save'}
                </button>
                {state?.error ? <span className="text-[13px] text-bad">{state.error}</span> : null}
                {state?.saved ? <span className="text-[13px] text-ok">Saved. The extension picks it up within five minutes.</span> : null}
                {plans.updatedAt ? <span className="ml-auto text-[12px] text-faint">Last changed {new Date(plans.updatedAt).toLocaleString('en-GB')}</span> : null}
            </div>
        </form>
    );
}
