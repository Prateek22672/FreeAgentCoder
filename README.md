# Agentic

An AI coding agent and app builder, like Claude Code, Codex or Bolt, that runs on **free** LLM tiers.

- **CLI** (`agentic`): works in any project folder, in any terminal, including VS Code's. It reads and searches code, makes exact edits, runs commands and tests, builds new projects, and asks before doing anything risky.
- **Web platform**: a **Builder** where you describe an app, the agent writes it, and you watch it in a live preview. An **Admin panel** covers provider keys, model checks, runs, issues and usage stats.
- **One engine** (`@agentic/core`) behind both.

## Quick start

```bash
npm install
npm run build                  # bundles the CLI
npm install -g ./packages/cli  # puts `agentic` on your PATH

agentic setup                  # add free API keys (tests each one)
cd your-project
agentic                        # interactive session
agentic "fix the failing test" # one task, then exit
```

Web platform:

```bash
npm run web                    # http://localhost:5180
```

In the web app, open **Admin → Providers & keys** first, add a key, then build in the **Builder**.

## Free models

Add as many as you like. The router fails over between them automatically.

| Provider | Free tier | Notes |
|---|---|---|
| **Google Gemini**: best place to start | yes | 1M-token context, strong at agentic coding. Key: https://aistudio.google.com/apikey |
| Groq | yes | Very fast, but the free tier caps at ~8K tokens/min, so it handles small requests and bigger ones are routed elsewhere. |
| Cerebras | yes | 1M tokens/day, 5 requests/min, 64K context. |
| Mistral | yes ("Experiment" plan) | Rate-limited, generous monthly tokens. |
| OpenRouter | yes (`:free` models) | 50 requests/day (1,000/day after a one-time $10 top-up). |
| Ollama | local | Private, unlimited, but needs a good GPU for coding models. |
| Anthropic Claude, OpenAI | paid, your key | Only used when you explicitly select them. |

Free-tier limits and model ids change often. When a model id is retired, the router asks the provider for its current list and picks the closest match automatically. Use **Admin → Model check** (web) to test whether a model can actually drive the agent: a plain reply, a tool call, and an exact edit.

## What makes it reliable on free models

- **Per-call failover.** If a provider hits a rate limit, the *next model call* goes elsewhere. Completed edits and commands are never redone.
- **Size-aware routing.** Requests too large for a provider's free tier skip it instead of failing.
- **Exact edits.** `edit_file` replaces a unique exact string. It won't edit a file the agent hasn't read, or one that changed on disk since. On a miss it shows the model the closest match so it can retry precisely.
- **Forgiving parsing.** Recovers the mistakes weak models make: broken JSON with raw newlines, `file_path` instead of `path`, tool calls written as text, leaked chat-template tokens, line-number prefixes pasted into edits.
- **Nudges.** "Let me do X" followed by nothing gets a nudge to act; three identical calls in a row break the loop.
- **Context compaction.** Old tool outputs are trimmed first, then the session is summarized when it gets long.
- **Undo.** `/undo` (CLI) or the ↶ button (web) reverts the last turn's file changes.
- **Permissions.** `ask` / `auto-edit` / `auto` modes. Catastrophic commands (`rm -rf /`, `mkfs`, ...) are always blocked; dangerous ones (`git push`, `rm -rf`, deploys) always ask.

## CLI reference

```
agentic [task]            interactive, or run one task
  -m, --model <ref>       gemini | groq:openai/gpt-oss-120b | anthropic:claude-opus-5 | ...
      --mode <mode>       ask (default) | auto-edit | auto
  -r, --resume [id]       resume the last session in this folder
      --verbose           show the model's reasoning
agentic setup             add or test API keys
agentic models            list providers and models
```

Inside a session: `/model`, `/models`, `/mode`, `/undo`, `/compact`, `/clear`, `/context`, `/cost`, `/todos`, `/sessions`, `/init` (writes an `AGENTS.md`), `/help`. Ctrl+C or Esc interrupts.

Projects can include an `AGENTS.md` (or `CLAUDE.md`) with instructions; it is loaded automatically.

## Layout

```
packages/core   the engine: agent loop, tools, model router, providers, permissions (Node + browser)
  src/node      Node-only: local files, shell tool, config, sessions
packages/cli    the terminal app (bundled to one file with esbuild)
apps/web        React platform: Builder (Sandpack live preview) + Admin panel
apps/relay      tiny Cloudflare Worker so browsers can reach providers that block CORS
docs/           DEPLOY.md: publishing the CLI, deploying the web app, VS Code
```

## Development

```bash
npm test          # 83 engine tests (fake models, fake HTTP provider, real shell)
npm run typecheck
npm run agentic   # run the CLI from source (tsx)
```
