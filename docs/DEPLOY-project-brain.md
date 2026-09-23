# Deploying Project Brain

The website (`apps/brain`) is a Next.js app. It has no database yet: analyses
live in memory for an hour, so a single Vercel project is all it needs.

## 1. Create the Vercel project

- **Import** the GitHub repository in Vercel → **Add New → Project**.
- **Root Directory:** `apps/brain`, and tick *Include source files outside of the Root Directory* (it uses `packages/core` and `packages/project-brain`).
- Framework preset: **Next.js**. The install and build commands come from `apps/brain/vercel.json`.

## 2. Environment variables

| Variable | Needed | What it does |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Yes | The canonical URL, `https://freeagentcoder.in`. Used for canonical tags, the sitemap and link previews. |
| `GITHUB_TOKEN` | Strongly recommended | Raises GitHub's rate limit from 60 requests an hour (shared by every visitor!) to 5,000. A fine-grained token with **no permissions** is enough for public repositories. |
| `GEMINI_API_KEY` | For the free trial | The key that answers visitors' free questions. Without it, everyone brings their own key. |
| `BRAIN_TRIAL_QUESTIONS` | Optional (default 2) | Free questions per visitor per day. |
| `BRAIN_TRIAL_DAILY_CAP` | Optional (default 200) | Free questions across everyone per day, so the key is never drained. |
| `BRAIN_TRIAL_SALT` | Optional | Any random string; used to hash visitor addresses for the trial count. |

Visitors' own keys are never stored: they stay in the visitor's browser and are
used for one request.

## 3. Domain

The home is **freeagentcoder.in** — an exact match for the brand, which is the
search people are most likely to win.

1. Point the domain at Vercel: add `freeagentcoder.in` (and `www`) in the project's
   **Domains**, then set the DNS records the dashboard shows at your registrar.
2. Set `NEXT_PUBLIC_SITE_URL=https://freeagentcoder.in`.
3. Keep **freeagentcoder.foliofyx.in** as a permanent redirect: add it as a domain
   too and mark it *Redirect to freeagentcoder.in* (308). Anything already linked
   or indexed then follows to the new home instead of splitting the signals.
4. The three guide URLs (`/free-copilot-alternative`, `/gemini-api-key-vscode`,
   `/best-free-ai-for-coding`) exist here with the same paths, so nothing indexed breaks.

### What .in costs you, honestly

`.in` is India's country domain, and Google reads a country domain as a signal
that the site is *for* that country. Expect a small lift in India and a small
disadvantage elsewhere. It does not stop the site ranking anywhere, and it is not
a penalty — but it cannot be turned off either: Search Console's international
targeting setting is locked for country domains.

What softens it:

- The **Marketplace listing** and the **GitHub repository** are the global entry
  points, both on global domains, and both already rank for the brand.
- Content stays plainly global (English, no country-specific pricing or claims).
- If `.com` becomes affordable later, buy it, make it canonical, and 308-redirect
  `.in` to it. The redirect carries the ranking across; nothing is wasted.

## 4. After the first deploy

## 4. After the first deploy

- Add the site in **Google Search Console** and submit `https://<domain>/sitemap.xml`.
- Check `https://<domain>/robots.txt` and the link preview at `https://<domain>/opengraph-image`.
- Rich Results Test: the home page should report **FAQ** and **SoftwareApplication**.

## Trial limits, honestly

Trial counts live in the server's memory. On Vercel each instance counts
separately, so a busy day can allow a few extra free questions per visitor. The
daily cap is the real protection for the key. Moving counts to Postgres or Redis
is the fix when the traffic justifies it.
