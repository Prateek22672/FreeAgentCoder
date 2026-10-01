/**
 * The project's own site, in one place.
 *
 * Two things point here: where anonymous counts are sent, and the "get a free
 * key" buttons. The buttons go through a redirect so the one number that
 * cannot be measured any other way — how many people who installed actually
 * reach the point of getting a key — is visible without asking anyone's
 * permission. The provider's real address is always shown next to the button,
 * so nothing is disguised and there is a way through if the site is down.
 */

export const SITE_URL = 'https://brain-rho-roan.vercel.app';

/**
 * The free trial for people with no key yet: an OpenAI-compatible endpoint on
 * the project's site, backed by its own keys, with a daily allowance.
 */
export const TRIAL_URL = `${SITE_URL}/api/trial/v1`;
/** The pseudo-provider and key id the trial uses inside the extension. */
export const TRIAL_PROVIDER = 'trial';

/** Where a "get a free key" button sends someone, counted on the way past. */
export function getKeyUrl(provider: string, version: string): string {
    const id = encodeURIComponent(provider.toLowerCase());
    return `${SITE_URL}/go/${id}?v=${encodeURIComponent(version)}`;
}
