# FreeAgentCoder — free AI coding agent for VS Code

[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/PrateekKoratala.freeagentcoder?label=Marketplace&color=d97757)](https://marketplace.visualstudio.com/items?itemName=PrateekKoratala.freeagentcoder)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ea043)](https://github.com/Prateek22672/FreeAgentCoder/blob/main/LICENSE.txt)
[![Source](https://img.shields.io/badge/source-open-6e7681)](https://github.com/Prateek22672/FreeAgentCoder)

**An autonomous AI coding agent and chat that runs on your own free API keys.**

FreeAgentCoder plans, writes, runs and verifies code in your project. Add free API keys from Gemini, Groq or Cerebras, and it sends each request to the right model, switching to your next key whenever one hits its limit.

It is a free alternative to paid AI coding assistants: no subscription, no per-seat fee and no usage metering of ours. The only limits are the free tiers of the keys you bring, and you can add as many keys as you like.

- **Free to use.** Runs on the free tiers of AI providers with your own keys. No account, no subscription.
- **A real agent.** Explores your project, makes a plan, edits files, runs your build and tests, and fixes what breaks.
- **Every step visible.** A live plan, inline diffs, live terminal output, and one-click undo.
- **Your keys stay on your device.** Encrypted in VS Code Secret Storage, never uploaded to FreeAgentCoder or anyone else, and sent only to the provider each key belongs to.
- **Understands what you show it.** Paste screenshots, PDFs, Word, PowerPoint or Excel files, or long text.
- **Takes corrections seriously.** Point at what's wrong and it fixes exactly that, then remembers the lesson.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/Prateek22672/FreeAgentCoder/main/freeagentcoder/media/screenshots/chat.png" alt="A task running: the plan, a file edit with its diff, and live status"></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/Prateek22672/FreeAgentCoder/main/freeagentcoder/media/screenshots/correction.png" alt="Correction mode: a pasted screenshot fixed point by point, with the lesson saved"></td>
  </tr>
  <tr>
    <td align="center"><b>Plans, edits and verifies</b> — every step visible</td>
    <td align="center"><b>Point out a fix</b> — with a screenshot, and it remembers</td>
  </tr>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/Prateek22672/FreeAgentCoder/main/freeagentcoder/media/screenshots/keys.png" alt="API keys: stored encrypted on your device, with usage and limits per key"></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/Prateek22672/FreeAgentCoder/main/freeagentcoder/media/screenshots/overview.png" alt="Overview: prompts left today, project status and feature switches"></td>
  </tr>
  <tr>
    <td align="center"><b>Your keys stay on your device</b> — usage and limits per key</td>
    <td align="center"><b>Prompts left today</b> — savings and every feature switch</td>
  </tr>
  <tr>
    <td colspan="2" align="center"><img src="https://raw.githubusercontent.com/Prateek22672/FreeAgentCoder/main/freeagentcoder/media/screenshots/health.png" width="50%" alt="Health: every job, the models serving it, and whether each key is working"></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><b>Health</b> — every job, the models serving it, and whether each key is working right now</td>
  </tr>
</table>

## Quick start

1. **Install.** A **Get started** guide opens by itself and shows you where everything is.
2. **Find it in the right side bar.** FreeAgentCoder opens next to your code, like a pair programmer. Open it any time with **FreeAgentCoder: Open Chat** from the Command Palette (`Ctrl+Shift+P`).
3. **Add free keys.** Settings → API Keys lists a direct link for each free provider. The best setup is **one key from each provider**:
   - Google Gemini: https://aistudio.google.com/apikey
   - Groq: https://console.groq.com/keys
   - Cerebras: https://cloud.cerebras.ai
   - OpenRouter: https://openrouter.ai/keys
   - Mistral: https://console.mistral.ai/api-keys

   **One key per account.** A second key from the same account shares that account's limits, so it adds nothing; add a different provider instead. Provider terms don't allow making extra accounts to get around limits.
4. **Ask.** Open a project folder and describe what you want, for example *"Explain how this project is structured and how to run it."* Or click **Test my project**.

## What you can ask it to do

- **Build:** scaffold apps, add features across many files, install dependencies, run production builds.
- **Fix:** run your tests or build, read the errors, fix them, and run again until they pass.
- **Understand:** explain code, trace how a feature works, answer questions about your codebase.
- **Ship:** add Dockerfiles and deployment config, and give you the exact deploy commands.
- **Correct:** show it what's wrong, with a screenshot or a note, and it fixes each point and verifies it.

## Attachments, corrections and memory

- **Paste or drop anything.** Screenshots, PDFs (including scanned ones), Word, PowerPoint and Excel files, or long pasted text. Documents are read on your computer, and so is the text in screenshots — no API request, no model, nothing sent anywhere. A vision model (Gemini, Mistral, OpenAI or Anthropic) is asked only when an image has little readable text, or when the layout, colours or a highlighted area are what matter.
- **Very long documents** are summarized for the agent and saved in `.freeagentcoder/attachments/` (git-ignored), so it can read the exact parts it needs.
- **Correction mode.** Click **Point out a fix** under a reply, or just say what's wrong. Each point you raise becomes its own item that is fixed with the smallest change and verified separately, and the reply ends with what was wrong, what changed and how it was checked.
- **Memory.** After a correction, FreeAgentCoder saves a short lesson (for example *"Use Riverpod for state, not setState"*) and follows it in later tasks. Type *"remember that …"* to teach it directly. Review, add or delete lessons in **Settings → Memory**, or turn learning off. Lessons are instructions stored on your computer; they don't retrain the models.

## Plan in Project Brain, build here

[Project Brain](https://github.com/Prateek22672/FreeAgentCoder/tree/main/apps/brain) is the website half of FreeAgentCoder. Paste a GitHub repository and it maps the stack and architecture, answers questions with real file references, and shows what a change would touch.

Describe the change there and click **Work on this in VS Code**. FreeAgentCoder opens with the plan written into the chat: the files involved and the steps in order. **Nothing runs until you press Send.**

## Checked before it says "done"

- **Your project's own checks.** FreeAgentCoder finds how your project is verified: type check, lint, tests and build from `package.json` scripts; `pytest`, `ruff` or `mypy` for Python; `flutter analyze` and `flutter test`; `cargo`, `go`, `dotnet`, Maven or Gradle. It uses your package manager and virtualenv.
- **No "done" on broken code.** A complex task that changed code can't finish until one of those checks has passed *after its last edit*, or it explains exactly why none can run.
- **Test my project.** One click runs every check it found and writes a report in plain words: what passed, and for each failure *what failed, why, and how to fix it*. It changes nothing unless you ask. For machine-learning projects it runs a small smoke check, never a full training run.
- **Knows your project's layout.** Complex tasks start with a compact map of your folders, so changes land in the right place.

## Never stops without telling you why

- **Warned before, not halfway.** When today's remaining limits look too small for a task, a card says so *before* work starts, with an **Add a key** button.
- **Daily limits handled.** A key that reaches its daily limit is set aside until it resets, the next key takes over, and you're told once.
- **Recovers on its own.** Rate limits and dropped connections are waited out and the task resumes. A conversation that outgrows your models is summarized and continued.
- **Plain-language errors.** If something truly can't continue, you see what happened and what to do, with the technical details folded away.

## Overview, savings and health

- **Settings → Overview** shows prompts left today (from the daily limits your providers report and your own average requests per prompt), **how much you saved** by using free keys instead of a paid model (an estimate with its basis shown), your project's stack and status, your last 7 days, and a switch for every feature.
- **Settings → Health** lists every job FreeAgentCoder routes to its own models (quick tasks, complex tasks, screenshot reader, scanned-PDF reader, lesson writer) and, for each key and model, whether it's healthy, rate-limited, out of daily quota or failing, with request counts, failures, average response time and the last error.

## Smart routing across all your keys

- **Auto mode** sends quick questions and small edits to the fastest models (Groq, Cerebras), and building, debugging and multi-file work to the strongest (Gemini). Choosing costs no extra request.
- **Several keys per provider.** Give each key a name, such as "Personal" or "College". When one is rate-limited, the next one continues the same task, starting with the key you've used least today.
- **Fast failover.** A failing model hands over immediately and cools down for a while. Invalid keys are detected and flagged.
- **Pin a model** at any time from the model menu. Your other free keys stay available as fallbacks.
- **No surprise bills.** Paid providers (OpenAI, Anthropic) are only used automatically when you have no free key.

## Senior mode for complex builds

When you ask for something big, such as *"build a Flutter wallpaper app that's ready to publish"*, FreeAgentCoder works like a senior engineer:

- **Checks your machine first.** It sees which SDKs are installed before writing code, and asks before installing anything system-wide.
- **Follows a stack playbook.** Flutter, web apps, Node.js APIs, Python backends and machine-learning projects each come with the structure, security rules and release steps they need.
- **Must pass quality checks.** It can't call the task done until analysis, tests and builds actually pass, or it explains exactly why one can't run.
- **Reports honestly.** A quality report lists every check it ran, passed or failed, plus a security and publishing checklist for you.
- **Recovers on its own.** If every model is rate-limited or your connection drops, the task waits and picks up where it stopped instead of failing. Press Stop at any time to cancel.

## Usage you can trust

- Tokens and requests for each key: today, since VS Code started, and over the last 30 days.
- Quota bars show only the limits a provider reports in its responses (Groq, Cerebras, Mistral, OpenRouter, OpenAI and Anthropic do). Gemini doesn't, so Gemini keys show local usage only.
- A warning when a key drops below 10% of a reported limit.
- **Limits across your keys:** each provider's reported limits added up across all your keys, so you can see how much is left in total.
- **Key suggestions** based on what actually happened: rate limits hit, limits nearly used up, fallbacks to weak models and the size of your tasks. For example: "Room for about 30 more tasks today".

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
- Instant local code search: a built-in index of file names and identifiers finds the right files for a request without using any API quota, and complex tasks start with the most relevant files already attached.

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
- **FreeAgentCoder: Test My Project**
- **FreeAgentCoder: Get Started**: reopens the setup guide

In the chat box, **Enter** sends, **Shift+Enter** adds a new line, **Esc** stops the current task, and **↑** brings back your last prompt.

## Privacy

- **Your API keys stay on your device.** They're stored encrypted in VS Code's Secret Storage (your operating system's keychain: Windows Credential Manager, macOS Keychain or Linux Secret Service), are never uploaded to FreeAgentCoder or anyone else, and are sent only to the provider each key belongs to when you run a task. They're never shown again after you save them.
- No account, no sign-up and no FreeAgentCoder server.
- Attachments are saved in your project's `.freeagentcoder/` folder, which is git-ignored automatically. Lessons learned from your corrections are stored on this computer only, and you can review or delete them in Settings → Memory.
- Your prompts and code are sent only to the providers whose keys you add, directly from your editor. Their terms apply, and some free tiers may use requests to improve their models, so check a provider's data policy before working on sensitive code.
- Chat history is saved only if you agree, and only on your computer. Turn it off or delete saved chats any time in Settings → History.
- Errors are logged locally in Settings → Logs. **Copy diagnostics** removes API keys, tokens and your username from paths before copying.
- Reading images on this computer downloads the reader once (about 6 MB) from a public CDN, and checks it against a fixed checksum before running it. Your image is never part of that: it is read on your machine and never uploaded.
- FreeAgentCoder has no server of its own and collects no telemetry.

## Requirements

- VS Code 1.137 or newer
- At least one API key
- A project folder open in VS Code

## License

MIT
