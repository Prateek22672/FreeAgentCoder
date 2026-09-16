# Launch kit — copy-paste actions

Everything in this file is ready to paste. Nothing here needs editing unless you want to add your own voice.

## 1. Create the GitHub Release (2 minutes)

Marketplace pages, and this repo's `links.releases` button, point at GitHub Releases — right now that link 404s because no release exists yet.

1. Go to https://github.com/Prateek22672/FreeAgentCoder/releases/new
2. **Tag:** `v0.1.2` (target: `main`)
3. **Title:** `v0.1.2 — Free Agent Coder`
4. **Description:** paste this:

   ```
   Attachments (screenshots, PDFs, Word, PowerPoint, Excel, long text), correction mode,
   memory that learns from your corrections, an Overview screen with prompts-left-today,
   automatic recovery from rate limits, local code search, and a clearer Marketplace
   listing name so the extension is easier to find.

   Full changelog: https://github.com/Prateek22672/FreeAgentCoder/blob/main/freeagentcoder/CHANGELOG.md
   ```

5. Drag in `freeagentcoder/freeagentcoder-0.1.2.vsix` as a release asset.
6. Click **Publish release**.

## 2. Publish to Open VSX (5 minutes, one-time account setup)

This makes the extension installable from Cursor, Windsurf and VSCodium, none of which can reach the VS Code Marketplace.

1. Sign in at https://open-vsx.org with your GitHub account.
2. Go to https://open-vsx.org/user-settings/tokens and create an access token. **Keep it private — don't paste it into any chat, including this one.**
3. In a terminal, from the `freeagentcoder` folder:
   ```
   npx ovsx publish freeagentcoder-0.1.2.vsix -p <your-token>
   ```
4. Done. After that, every future release can also be published with `npx ovsx publish -p <token>`.

## 3. Add GitHub repo topics (30 seconds)

On https://github.com/Prateek22672/FreeAgentCoder, click the gear icon next to "About" and paste these into Topics:

```
vscode-extension ai-agent ai-coding-assistant coding-agent free open-source gemini groq cerebras openrouter byok agentic-ai vibe-coding
```

Also set the repo's **Website** field to `https://freeagentcoder.foliofyx.in`.

## 4. Ask for reviews (biggest single lever right now)

At 17 installs and 0 reviews, five honest reviews will do more for ranking and trust than anything else. Message people who've already installed it and point them at:

`https://marketplace.visualstudio.com/items?itemName=PrateekKoratala.freeagentcoder&ssr=false#review-details`

## 5. Take 4 screenshots (5 minutes)

The Marketplace has **no image upload form** — listing images come from the README, so they just need to live in the repo.

Save them into `freeagentcoder/media/screenshots/` with these exact names:

| Filename | What to capture |
| --- | --- |
| `chat.png` | A task mid-run: plan checklist, a diff card, model chip visible |
| `keys.png` | Settings → API Keys, with the "stays on your device" note |
| `overview.png` | Settings → Overview: prompts left, project status, feature switches |
| `correction.png` | A reply with the Correction chip after pointing out a fix |
| `demo.gif` | *Optional*, 15–20s screen recording ([ScreenToGif](https://www.screentogif.com/)) |

How: `Win` + `Shift` + `S`, drag over **just the FreeAgentCoder panel** (not the whole window), click the notification, **Save As** into that folder. Dark theme, PNG only, under ~1 MB each.

Then say the word — the README block and the website gallery get wired up, pointing at raw GitHub URLs so the images show on the Marketplace without bloating the `.vsix`.

## 6. Post to communities (draft copy below — post under your own accounts)

**Reddit (r/vscode, r/ChatGPTCoding), title:**
> I built a free VS Code AI agent that runs on your own free Gemini/Groq/Cerebras keys — no subscription

**Body:**
```
Most AI coding tools are subscriptions. FreeAgentCoder is a free, open-source (MIT)
VS Code extension that runs on API keys you bring yourself — Gemini, Groq, Cerebras,
Mistral and OpenRouter all have free tiers, and it fails over between whichever keys
you add so a rate limit doesn't stop your task.

It's a real agent, not autocomplete: it plans, edits files across your project, runs
your tests/build, and keeps going until they pass. It can also read a pasted
screenshot or PDF, and there's a "point out a fix" mode where it fixes exactly what
you flag and remembers the lesson for next time.

Keys stay on your device (VS Code Secret Storage), no telemetry, no account.

Marketplace: https://marketplace.visualstudio.com/items?itemName=PrateekKoratala.freeagentcoder
GitHub: https://github.com/Prateek22672/FreeAgentCoder

Happy to answer questions — genuinely want feedback on what breaks.
```

**dev.to article title:** "I built a free, open-source alternative to paid AI coding assistants" — can expand into a full post from the `free-copilot-alternative` page content if you want; ask and it'll be written.

**X/Twitter:**
```
Built a free AI coding agent for VS Code. No subscription — it runs on your own
free API keys (Gemini, Groq, Cerebras) and switches between them automatically
when one hits a rate limit. Open source, MIT licensed.

https://marketplace.visualstudio.com/items?itemName=PrateekKoratala.freeagentcoder
```

## 7. YouTube demo — 60-second script

No editing needed, just screen-record following this:

1. **(0:00–0:05)** Show the Marketplace page, click Install.
2. **(0:05–0:15)** Open Settings → API Keys, paste a free Gemini key, show it verify.
3. **(0:15–0:40)** Type a real request ("add a dark mode toggle" or similar), let it run: show the plan appear, a file get edited (diff card), a test run.
4. **(0:40–0:50)** Point at the Overview tab: "prompts left today", feature switches.
5. **(0:50–0:60)** End card: "Free, open source, runs on your own API keys" + the GitHub URL.

Upload as unlisted first if you want to review it, then public. Title: "Free AI Coding Agent for VS Code — No Subscription (Gemini/Groq/Cerebras)".

## 8. Verified publisher badge — not yet possible, no action needed

Requires the publisher to have had an extension live for 6 months **and** the domain to be 6 months old. Nothing to do until ~March 2027. One thing to decide before then: **changing the publisher display name later revokes the badge once granted**, so if you ever want it to show something other than "Prateek Koratala" (e.g. an "Imperium" brand), change it now rather than after verifying — otherwise no rush.

## 9. The "Do you trust the publisher?" dialog — cannot be removed, by anyone

This is a stock VS Code security prompt shown on first install from *any* publisher that isn't verified yet — it is generated by VS Code itself, not by this extension, and there is no setting, manifest field or code change that suppresses it. It appears for every new extension on the Marketplace, including ones with a million installs, until their publisher earns the verified badge (see #8). The only real fix is time + the badge; until then, reviews, the README, and the GitHub repo link are what actually reassure someone looking at that dialog.
