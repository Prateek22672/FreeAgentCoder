# Growth plan

Written 2026-09-24. Every number here was checked against a live API or Google
autocomplete on that date, and the ones that could not be checked are marked as
judgement. Re-check before trusting anything older than a month.

## The strategy in one line

**Be the answer to "free alternative to Claude Code", reach every editor through
one integration instead of five, and never pay for a stranger's inference.**

---

## 1. What is true today

| | Verified value |
|---|---|
| Marketplace installs | 139, 4.75★ from 4 ratings |
| Open VSX | **not published** — the API returns "Extension not found" |
| GitHub repo | 0 stars, no description, no topics, no releases |
| `freeagentcoder.com` | does not resolve (not bought) |
| npm `freeagentcoder` | **available** |
| Published version | 0.2.0. 0.3.0 is built, tested and uncommitted to the Marketplace |

Two facts sit underneath everything else:

- **The positioning already ranks.** `free alternative to cl` autocompletes first
  to **`free alternative to claude code`** — above Claude AI itself. On the bare
  stem `free alternative to` it sits among Spotify, Canva and Photoshop.
- **Every channel currently ends at a dead link.** The repo's homepage field, the
  old subdomain and the `.com` all fail. `apps/site` already contains
  `best-free-ai-for-coding/`, `free-copilot-alternative/` and
  `gemini-api-key-vscode/` — built, and unreachable.

---

## 2. Phase 0 — unblock (days, not weeks)

Nothing in later phases pays off until these are done.

1. **One canonical URL that serves.** Point the Marketplace listing, README, repo
   homepage and CI at it; 301 everything else. Until then every promotion leaks.
2. **Set the usage-data endpoint to that URL** before publishing 0.3.0. It is
   compiled in; publishing first means the admin page stays empty and you will not
   know why.
3. **Publish 0.3.0** after installing the `.vsix` locally and attaching a
   screenshot once, to watch the reader download itself.
4. **Publish to Open VSX.** `.github/workflows/release.yml` already has the
   `ovsx publish` step — it is skipped only because `OVSX_PAT` is unset. Sign the
   Eclipse agreement, create the namespace, set the secret, push a tag.
   *Why first: Cline has **6,674,318** Open VSX downloads against 5.4M Marketplace
   installs. Open VSX feeds Cursor, Windsurf, VSCodium, Antigravity, Kiro, Gitpod
   and Trae. Its AI category holds 1,185 extensions against the Marketplace's
   4,291 — you are 3.6× less buried there.*
5. **Repo hygiene**: description, topics, homepage, first Release. Half an hour,
   and it is the prerequisite for every awesome-list PR.

---

## 3. Phase 1 — reach every editor with one integration

### 3.1 A CLI on npm

`npx freeagentcoder` works anywhere Node is installed: no store, no signing, no
review. The name is free; the current `@agentic/*` names are taken by other
publishers and cannot ship.

Weekly npm downloads in this category: `@openai/codex` 14.69M,
`@anthropic-ai/claude-code` 8.67M, `opencode-ai` 1.67M, `@google/gemini-cli`
290k. **The honest counterweight:** `@continuedev/cli` does 2,953/week despite
Continue's 4.2M installs. A CLI compounds only if it is genuinely usable on its
own, not a checkbox.

### 3.2 Agent Client Protocol

One stdio JSON-RPC server, and the agent appears inside **Zed, JetBrains IDEs,
Neovim, Emacs, Sublime Text, Qt Creator and Visual Studio** — none of which you
write UI for. The SDK is `@agentclientprotocol/sdk`; registry listing is one PR
with an `agent.json` and a 16×16 SVG, and JetBrains consumes that registry
directly.

This is the highest reach per hour available, and it settles the "should we port
to JetBrains / Zed / Neovim" question permanently — by making all three fall out
of one piece of work.

---

## 4. Phase 2 — content that earns its traffic

Two plays, both with **zero inference cost**, both aimed at people who already
have a key in their clipboard.

### 4.1 A live free-tier tracker

One page per provider plus a master table: what the free tier actually gives you
today, dated and re-verified.

*Why it is winnable:* every page ranking today is a dated blog snapshot. One of
them has to explain that Google cut free quotas 50–80% in December 2025 — which
means the rest are wrong and Google ranks them anyway, because nothing better
exists. Your router talks to all five providers daily, so you have first-party
freshness nobody on that SERP has. Timestamp every number or do not run the play.

### 4.2 A key-setup generator

Pick a tool and a provider, get the exact config to paste, plus that provider's
current limits — and a one-line "or install the extension and skip this".

*Why it is winnable:* page 1 for `add gemini api key to vs code` is two YouTube
videos, two Reddit threads, a LinkedIn post and a Google deprecation notice.
`free api key for roo code`, `for kilo code`, `for open code` are literal
autocomplete suggestions with nobody serving them. Helping people configure Cline
and Roo is not charity — it earns the ranking, and your extension is the shortcut
on the same page.

### 4.3 Alternatives, capped

~25 `<tool> alternative (free)` pages, data-backed from the GitHub and Marketplace
APIs. **Cap it deliberately**: benchlm.ai has ~129,785 URLs of model-vs-model
pages. You cannot out-mass that. Win on tested, current and opinionated.

---

## 5. Phase 3 — tell people, in this order

1. Awesome-list PRs: `awesome-ai-coding-tools` (2,102★, explicitly welcomes PRs),
   then `awesome-cli-coding-agents` once the CLI ships.
2. One value-first post to r/LocalLLaMA (832k) or r/ChatGPTCoding (383k) — a
   technical write-up with the tool as context, not as the headline. Both enforce
   roughly 1:10 self-promotion ratios; a launch post gets removed.
3. Outreach to "best free AI coding agent 2026" authors. Those posts refresh
   weekly and are what AI assistants quote back.
4. **Show HN last**, once 1–4 are live. One documented front-page post (rank 17,
   68 points) produced 3,500–4,000 visitors, ~8,000 over four days. You get one
   shot; do not spend it while the site is down.

**YouTube is the accelerant, not a step.** Videos on exactly this pitch run
402k, 400k, 351k, 238k views, and the 8-day-old one is at 78k — the appetite
renews weekly, and those channels hunt for new tools. But no verifiable evidence
was found that YouTube coverage drove installs for Cline, Roo or Kilo, so treat
placement as a bet worth making, not a plan to rely on.

---

## 6. What we are deliberately not doing

**Microsoft Store — skip.** Not one of the nine major AI coding tools has an
official listing; the "Cursor" entry there is an unrelated file-sharing app. The
Store publishes no install counts. VS Code has 8,780 US ratings against 50M
monthly users, and Windows Terminal — preinstalled on every Windows 11 machine —
has 9,486. Microsoft's own winget client has a public issue titled "not
discoverable in the Microsoft Store". The only verified Store-vs-website split on
record is Krita's: 0.4%. The one real benefit is free MSIX code signing, which
only matters if a desktop binary exists — and it should not.

**Electron desktop app — skip, but not because of the money.** Windows signing can
be **$0** for an MIT project (SignPath Foundation, or free MSIX signing through the
Store), and paying for an EV certificate is wasted — Microsoft removed EV's instant
SmartScreen bypass in 2024. So the cost objection is weaker than it looks; a Mac
build still needs Apple Developer at $99/year for notarized auto-update.

The verdict rests on the other two things instead. **Maintenance:** Electron ships
a major every 8 weeks and supports only the latest three, so you must upgrade
roughly every 24 weeks or run an unpatched Chromium — and a VS Code-like workbench
means maintaining a patch set against every upstream release, forever.
**Evidence:**
Homebrew 365-day installs are `claude-code` 1,130,098 and `codex` 811,583 — both
CLIs — against `cursor` 120,556, the flagship desktop editor. Every standalone AI
editor is VC-funded with a team; every solo project ships extension + CLI. **The
CLI and ACP reach every audience a desktop app would, for nothing.**

**Generic dev utilities** (JSON formatter, regex tester, diff checker, cron,
base64, JWT). Google literally suggests `json formatter**.org**` and
`online python compiler **programiz**` — brand-level ownership by decade-old
domains — and someone formatting JSON has no reason to install a coding agent.
Maximum difficulty, minimum conversion.

**Model-vs-model pages** (benchlm.ai has ~129,785), **per-model token counters**
(pricepertoken.com has 750), **llms.txt tools** (audience is SEO marketers),
and the **`ai agent` / `agentic ai` head terms** (autocomplete: *meaning, course,
jobs, roadmap, engineer salary in india* — a careers audience owned by IBM, AWS
and Coursera).

**The word "BYOK"** in any title. `byok` autocompletes to *meaning · full form*.
`use my own api key` autocompletes to nothing but tool names. Same idea, plain
words.

---

## 7. The rule that protects the business

**Never spend model inference on anonymous visitors.** The whole product thesis
is "don't pay for inference"; inverting that on the marketing site means the
better it ranks, the more it costs, and scrapers arrive before customers. Keep
free paths static or client-side, and reserve model calls for people who supply
a key.

---

## 8. What success looks like, honestly

Judgement, not measurement — no keyword volume data exists here, and Trends was
blocked.

| | Search traffic | The number that matters |
|---|---|---|
| 0–3 months | hundreds to low thousands/month | installs from Open VSX + CLI, not search |
| 3–6 months | low thousands, up to ~10k/month | does the setup generator convert? |
| 6–12 months | 10k–50k/month is a strong outcome | Marketplace ranking starting to compound |

**100k+/month needs a hit, not a plan.** crontab.guru launched on Hacker News in
2019 and owns its cluster now; it-tools started in 2020 and has 40,677 stars.
None of these were twelve-month stories.

And traffic is not the currency: at 139 installs the Marketplace flywheel —
installs drive ranking drives installs — has not started. 5,000 visitors who
install beat 500,000 who came for a JSON formatter.

### Kill/keep rules, written before the ego arrives

- **The repo analyser**: if under 3% of visitors reach the "Work on this in
  VS Code" click over two weeks and ~500 visitors, cut it to a static demo and a
  video.
- **The CLI**: if it is not genuinely usable standalone within a month of
  shipping, stop promoting it — `@continuedev/cli` is the warning.
- **Any content play**: if a cluster has no page in the top 20 after three months
  of being indexed, stop adding pages to it.
