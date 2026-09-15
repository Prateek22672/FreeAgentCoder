# Launching Agentic (all free)

There are three ways people use Agentic. All three can launch at $0.

## 1. CLI on npm (works in VS Code's terminal, like Claude Code)

The CLI is one bundled file with no runtime dependencies.

```bash
# pick a package name you own: npm names are global, e.g. @your-npm-user/agentic
# edit packages/cli/package.json: "name", remove "private" if present, add "repository"/"license"
npm run build
cd packages/cli
npm login
npm publish --access public
```

Users then run:

```bash
npm install -g @your-npm-user/agentic
agentic setup
```

It runs in any terminal: VS Code, Windows Terminal, macOS, Linux. Each user brings their own free keys, so your cost is $0 no matter how many people use it.

## 2. Web platform on Cloudflare Pages + relay Worker

Cloudflare's free plan allows commercial use. Vercel's free Hobby plan does not.

**Web app (static site):**

```bash
npm run web:build          # outputs apps/web/dist
npx wrangler pages deploy apps/web/dist --project-name agentic
```

Or connect the GitHub repo in the Cloudflare dashboard: build command `npm run web:build`, output directory `apps/web/dist`.

**Relay** (lets the browser reach Groq, Cerebras and Mistral, which block direct browser calls):

```bash
cd apps/relay
npx wrangler deploy        # -> https://agentic-relay.<you>.workers.dev
```

Set `ALLOWED_ORIGIN` in `wrangler.toml` to your Pages URL, then paste the relay URL into **Admin → Settings → Connection**. The relay only forwards to known LLM APIs and stores nothing; users' keys pass through it. The free tier covers 100k requests/day.

Gemini, OpenRouter and Anthropic accept browser calls directly, so they work even without the relay.

**Where data lives:** keys, projects and run history stay in each user's browser (localStorage + IndexedDB). There is no database or server to pay for.

## 3. VS Code extension (next step)

Two options, easiest first:

1. **Today:** users install the CLI and run `agentic` in VS Code's integrated terminal.
2. **Native extension** (sidebar chat, inline diffs, accept/reject): create an extension with `npx --package yo --package generator-code -- yo code`. Import `@agentic/core` and `@agentic/core/node`, render agent events in a webview, and route approvals to VS Code dialogs. The engine already exposes everything needed: an event stream, an `approve()` callback, `LocalWorkspace`, and undo. Publish free to the **VS Code Marketplace** (`npx @vscode/vsce publish`) and **Open VSX** (for Cursor, Windsurf and VSCodium).

## Keeping it free at scale

- Everyone brings their own free keys (BYOK), so provider costs never land on you.
- If you later offer "no key needed" hosted usage, put *your* keys behind the relay with per-user rate limits. That is when it stops being free, so charge for it or cap it.
- Free-tier model ids change. The router self-heals retired ids, and `PRESETS` in `packages/core/src/providers/presets.ts` is the one place to update defaults.
