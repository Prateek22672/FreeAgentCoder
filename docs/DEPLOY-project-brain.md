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
| `NEXT_PUBLIC_SITE_URL` | Yes | The canonical URL, `https://freeagentcoder.com`. Used for canonical tags, the sitemap and link previews. |
| `GITHUB_TOKEN` | Strongly recommended | Raises GitHub's rate limit from 60 requests an hour (shared by every visitor!) to 5,000. A fine-grained token with **no permissions** is enough for public repositories. |
| `GEMINI_API_KEY` | For the free trial | The key that answers visitors' free questions. Without it, everyone brings their own key. |
| `BRAIN_TRIAL_QUESTIONS` | Optional (default 2) | Free questions per visitor per day. |
| `BRAIN_TRIAL_DAILY_CAP` | Optional (default 200) | Free questions across everyone per day, so the key is never drained. |
| `BRAIN_TRIAL_SALT` | Optional | Any random string; used to hash visitor addresses for the trial count. |
| `ADMIN_TOKEN` | For the admin page | Any long random string. `/admin?token=…` shows installs, keys per user, provider mix and what stops tasks. Until it is set, the page shows nothing at all. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | For keeping counts | Any Upstash-compatible Redis REST endpoint (Vercel KV is one). Without them the counts from the extension are held in memory and reset on every deployment. |

Visitors' own keys are never stored: they stay in the visitor's browser and are
used for one request.

## 3. Domain

Buy **freeagentcoder.com**. A `.in` address is read by Google as a site meant
for India: country domains are geo-targeted, `.in` is not on Google's list of
country domains treated as generic (`.io`, `.ai`, `.co`, `.me` and a handful of
others are), and the Search Console setting that used to override that was
removed in 2022 and never applied to country domains anyway. The audience here
is worldwide — the same searches appear in the US, UK, Germany, India,
Singapore and Brazil in almost the same order — so a neutral domain is worth
the few hundred rupees a year.

- If `.com` is gone, use `.dev`, `.io` or `.co`; all are treated as generic.
- Keep any older address alive as a 308 redirect. The redirect carries the
  ranking across; nothing is wasted.
- Set `NEXT_PUBLIC_SITE_URL` to the final address before the first deploy, so
  canonical tags and the sitemap never point at a name you are leaving.

## 4. The stats endpoint

The extension sends its anonymous counts to `https://freeagentcoder.com/api/stats`,
which is written into `freeagentcoder/src/telemetry/telemetry.ts`. **Confirm the
domain matches before publishing the extension**: a published extension cannot be
pointed somewhere else without a new release.

## 5. After the first deploy

- Add the site in **Google Search Console** and submit `https://<domain>/sitemap.xml`.
- Check `https://<domain>/robots.txt` and the link preview at `https://<domain>/opengraph-image`.
- Rich Results Test: the home page should report **FAQ** and **SoftwareApplication**.

## Trial limits, honestly

Trial counts live in the server's memory. On Vercel each instance counts
separately, so a busy day can allow a few extra free questions per visitor. The
daily cap is the real protection for the key. Moving counts to Postgres or Redis
is the fix when the traffic justifies it.
