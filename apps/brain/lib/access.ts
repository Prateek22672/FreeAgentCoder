import 'server-only';
import type { ModelRouter } from '@agentic/core';
import { getTrialRouter, providerLabel, routerForKey } from './ai';
import { fail } from './http';
import { refundTrial, trialStatus, useTrial } from './trial';

/**
 * Who pays for a model call: the visitor's own key, sent with the request and
 * never stored, or one of the site's free trial questions.
 */
export type Access =
    | {
          router: ModelRouter;
          mode: { mode: 'own'; provider: string } | { mode: 'trial'; remaining: number; limit: number };
          setCookie?: string;
          /** Gives the trial question back when the call fails, so a visitor never pays for our error. */
          refund: () => void;
          /** Provider errors can quote the request; a visitor's key must never come back in one. */
          scrub: (text: string) => string;
      }
    | { response: Response };

export async function resolveAccess(request: Request, noun = 'questions'): Promise<Access> {
    const ownProvider = request.headers.get('x-brain-provider');
    const ownKey = request.headers.get('x-brain-key');
    const scrub = (text: string) => (ownKey ? text.split(ownKey).join('[your key]') : text);

    if (ownProvider && ownKey) {
        const router = routerForKey(ownProvider, ownKey);
        if (!router) return { response: fail('That key does not look right. Paste the whole key, and pick the provider it came from.', 400, { badKey: true }) };
        return { router, mode: { mode: 'own', provider: providerLabel(ownProvider) }, refund: () => {}, scrub };
    }

    const router = await getTrialRouter();
    if (!router) return { response: fail(`Add your own free AI key to continue. It takes about a minute.`, 402, { needKey: true, reason: 'no-server-key' }) };
    const trial = trialStatus(request);
    if (trial.remaining <= 0) {
        return {
            response: fail(
                trial.closed
                    ? `Today's free ${noun} on this site are used up. Add your own free key to keep going — it takes about a minute.`
                    : `You've used today's free ${noun}. Add your own free key to keep going — it takes about a minute.`,
                402,
                { needKey: true, reason: 'trial-used' },
            ),
        };
    }
    useTrial(request, trial.visitorId);
    return {
        router,
        mode: { mode: 'trial', remaining: trial.remaining - 1, limit: trial.limit },
        setCookie: trial.setCookie,
        refund: () => refundTrial(request, trial.visitorId),
        scrub,
    };
}
