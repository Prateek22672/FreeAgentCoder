/** One place for the facts every page needs: the canonical URL, the links, and the pitch. */

/**
 * The canonical home. Set NEXT_PUBLIC_SITE_URL in the deployment once the real
 * domain is connected; until then a Vercel deployment uses its own address, so
 * canonical tags, the sitemap and link previews always agree with where the
 * site actually is.
 */
function canonicalUrl(): string {
    const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    if (configured) {
        return configured;
    }
    const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
    return vercel ? `https://${vercel}` : 'https://freeagentcoder.com';
}

export const SITE_URL = canonicalUrl().replace(/\/$/, '');

/**
 * A deployment on its temporary Vercel address is kept out of search: pages
 * indexed under a name the site is about to leave become duplicates of the
 * real ones, and that is a mess to undo. Connecting the domain turns indexing
 * on by itself.
 */
export const INDEXABLE = !/(^|\.)vercel\.app$/i.test(new URL(SITE_URL).hostname);

export const MARKETPLACE = 'https://marketplace.visualstudio.com/items?itemName=PrateekKoratala.freeagentcoder';
export const GITHUB = 'https://github.com/Prateek22672/FreeAgentCoder';
export const PRODUCT = 'FreeAgentCoder';
export const TAGLINE = 'Your codebase has a brain.';

export const DESCRIPTION =
    'A free, open-source AI coding agent for VS Code that runs on free Gemini, Groq and Cerebras API keys — plus Project Brain: chat with any GitHub repo and see what a change breaks.';

export const canonical = (path = '/') => `${SITE_URL}${path === '/' ? '' : path}`;
