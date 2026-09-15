# FreeAgentCoder

**An autonomous AI coding agent for VS Code that runs on free models.**

FreeAgentCoder plans, writes, runs and verifies code in your project. Add free API keys from Gemini, Groq or Cerebras, and it sends each request to the right model, switching to your next key whenever one hits its limit.

- **Free to use.** Runs on the free tiers of AI providers with your own keys. No account, no subscription.
- **A real agent.** Explores your project, makes a plan, edits files, runs your build and tests, and fixes what breaks.
- **Every step visible.** A live plan, inline diffs, live terminal output, and one-click undo.
- **Your keys stay on your machine.** Encrypted in VS Code Secret Storage, and requests go straight to the providers you choose.

## Quick start

1. Install FreeAgentCoder, then click the **FreeAgentCoder** icon in the activity bar.
2. Open **Settings → API Keys → Add API key** and paste a free key. Each key is checked with the provider before it's saved.
   - Google Gemini: https://aistudio.google.com/apikey
   - Groq: https://console.groq.com/keys
   - Cerebras: https://cloud.cerebras.ai
3. Open a project folder and ask something, for example: *"Explain how this project is structured and how to run it."*

## What you can ask it to do

- **Build:** scaffold apps, add features across many files, install dependencies, run production builds.
- **Fix:** run your tests or build, read the errors, fix them, and run again until they pass.
- **Understand:** explain code, trace how a feature works, answer questions about your codebase.
- **Ship:** add Dockerfiles and deployment config, and give you the exact deploy commands.

## Smart routing across all your keys

- **Auto mode** sends quick questions and small edits to the fastest models (Groq, Cerebras), and building, debugging and multi-file work to the strongest (Gemini). Choosing costs no extra request.
- **Several keys per provider.** Give each key a name, such as "Personal" or "College". When one is rate-limited, the next one continues the same task, starting with the key you've used least today.
- **Fast failover.** A failing model hands over immediately and cools down for a while. Invalid keys are detected and flagged.
- **Pin a model** at any time from the model menu. Your other free keys stay available as fallbacks.
- **No surprise bills.** Paid providers (OpenAI, Anthropic) are only used automatically when you have no free key.

## Usage you can trust

- Tokens and requests for each key: today, since VS Code started, and over the last 30 days.
- Quota bars show only the limits a provider reports in its responses (Groq, Cerebras, Mistral, OpenRouter, OpenAI and Anthropic do). Gemini doesn't, so Gemini keys show local usage only.
- A warning when a key drops below 10% of a reported limit.

## Safe by default

| Mode | Does without asking |
| --- | --- |
| Manual | Reads files |
| Auto-edit (default) | Reads and edits files |
| Auto | Reads and edits files, runs commands |

- Risky commands, such as deleting files, `git push` or deploys, always ask first.
- Commands that could wipe a disk are always blocked.
- Any task that changed files can be undone from the chat.

## Works with your codebase

- Follows your team's conventions from `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md` or `.cursorrules`.
- Detects your stack (Node.js frameworks and scripts; Python with uv, poetry, conda or pip; Rust, Go, Java, .NET and Docker), so it spends less time exploring.
- Python and ML aware: uses your virtualenv, keeps test runs small, runs long training jobs in the background, and reads Jupyter notebooks as clean cells without their outputs.
- Respects `.gitignore` and skips dependency, cache and experiment-tracking folders.

## Supported providers

| Provider | Plan | Good to know |
| --- | --- | --- |
| Google Gemini | Free tier | 1M-token context; daily request quota |
| Groq | Free tier | Very fast; small per-minute token limit |
| Cerebras | Free tier | Fast; per-minute request limit |
| Mistral | Free tier | "Experiment" plan, needs phone verification |
| OpenRouter | Free models | Daily request limit |
| OpenAI | Paid | Bring your own key |
| Anthropic | Paid | Bring your own key |

Free-tier limits change often, so check each provider's site. Keys you already have in environment variables (such as `GEMINI_API_KEY`) or in the Agentic CLI config (`~/.agentic/config.json`) are picked up too, marked **ENV** or **CLI**.

## Commands

- **FreeAgentCoder: Open Chat**
- **FreeAgentCoder: New Chat**
- **FreeAgentCoder: Manage API Keys**
- **FreeAgentCoder: Show Usage**
- **FreeAgentCoder: Stop Current Task**

In the chat box, **Enter** sends, **Shift+Enter** adds a new line, **Esc** stops the current task, and **↑** brings back your last prompt.

## Privacy

- API keys are encrypted in VS Code Secret Storage and never shown again after you save them.
- Your prompts and code are sent only to the providers whose keys you add, directly from your editor. Their terms apply, and some free tiers may use requests to improve their models, so check a provider's data policy before working on sensitive code.
- FreeAgentCoder has no server of its own and collects no telemetry.

## Requirements

- VS Code 1.137 or newer
- At least one API key
- A project folder open in VS Code

## License

MIT
