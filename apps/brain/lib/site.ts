/** One place for the facts every page needs: the canonical URL, the links, and the pitch. */

/**
 * The canonical home: the exact-match brand domain. Override with
 * NEXT_PUBLIC_SITE_URL in the deployment (e.g. a preview URL, or
 * https://freeagentcoder.foliofyx.in if the old subdomain is kept), so canonical
 * tags, the sitemap and link previews all point at one address.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://freeagentcoder.com').replace(/\/$/, '');
export const MARKETPLACE = 'https://marketplace.visualstudio.com/items?itemName=PrateekKoratala.freeagentcoder';
export const GITHUB = 'https://github.com/Prateek22672/FreeAgentCoder';
export const PRODUCT = 'FreeAgentCoder';
export const TAGLINE = 'Your codebase has a brain.';

export const DESCRIPTION =
    'A free, open-source AI coding agent for VS Code that runs on free Gemini, Groq and Cerebras API keys — plus Project Brain: chat with any GitHub repo and see what a change breaks.';

export const canonical = (path = '/') => `${SITE_URL}${path === '/' ? '' : path}`;
