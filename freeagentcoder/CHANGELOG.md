# Changelog

## 0.3.0 — Work on tasks from Project Brain

### Added

- **Screenshots are read on your computer.** A text reader runs locally and pulls the text out of a screenshot — an error, a stack trace, a terminal, a block of code — with no API request at all, so your free limits go to the coding instead. It downloads about 6 MB the first time and works offline after that. A vision model is asked only when an image holds little readable text, or when what matters is the layout rather than the words. Turn it off in **Settings → Overview**.
- Anything read locally is marked as such in the prompt, with a warning that a reader gets capitals, quotes and spacing wrong, so the agent looks names up in your project instead of trusting the spelling.
- **Project Brain handoff.** Plan a change on the Project Brain website, click **Work on this in VS Code**, and FreeAgentCoder opens with the plan written into the chat: the goal, the files involved, and the steps in order. Nothing runs until you read it and press Send, and every edit still follows your permission mode.
- The handoff checks the open folder: if it is not the repository the task was planned for, FreeAgentCoder says so before you send.
- Task links are validated before anything is shown: malformed links, unknown versions, oversized content and file paths outside the project are refused.

## 0.2.0 — Checked work, clear limits, easy to find

### Added

- **Right side bar.** FreeAgentCoder now opens in the right side bar, next to your code.
- **Get started guide.** Opens right after install and shows where FreeAgentCoder is, how to add keys and how to ask for a first task. Reopen it with **FreeAgentCoder: Get Started**.
- **Test my project.** Runs the project's own type check, lint, tests and build, and explains every failure in plain words with a fix. Also available as **FreeAgentCoder: Test My Project**.
- **Checked before done.** Complex tasks that change code must pass one of the project's own checks after their last edit before they can finish. Checks are detected for Node.js, Python, Flutter/Dart, Rust, Go, .NET and Java.
- **Project layout map** given to complex tasks at the start of a chat.
- **Health** in Settings: every job FreeAgentCoder routes to its own models, and each key and model's status, requests, failures, response time and last error.
- **Limit warnings before a task starts** when today's remaining limits look too small, with an Add a key button.
- **Savings** in Overview: what your free-key usage would have cost on a paid model.
- **Recommended key setup** with a direct, underlined link for each free provider, and a clear note to get one key per account.

### Changed

- Daily limits are recognized: the key is set aside until it resets, the next key takes over, and the task no longer waits pointlessly for a limit that resets hours later.
- A conversation too large for every model is summarized and the task continues.
- Errors show a plain-language title and next step, with technical details folded away. Key and limit problems appear as warnings, not failures.
- The chat panel opens faster: pdf.js is loaded only when a PDF is attached.
- New orange brand color throughout the chat panel, buttons, switches and icon.
- Adding a key: "Get a free Gemini key" (named for the selected provider) is a clear full-width button, a pasted key selects its provider automatically, and a Paste button reads the clipboard in one click.
- Marketplace description and keywords use the terms people search for, plus screenshots and a support link.

### Fixed

- The "Get a free key" and "Save key" buttons showed overlapping, cut-off text: updating a button's label replaced its icon instead.

## 0.1.1 — Easier to find

### Changed

- The Marketplace name is now "Free Agent Coder — Free AI Coding Agent", with a clearer description and keywords, so the extension turns up for searches like "free ai agent", "coding agent" or "free agent coder". The extension id and all commands are unchanged.

## 0.1.0 — First public release

### Added

- Chat panel with formatted Markdown replies, a live plan, grouped file exploration, inline diffs, live command output, approval cards and one-click undo.
- API key manager: named keys per provider, verified before saving and encrypted in VS Code Secret Storage, with test, rename, disable and remove.
- Automatic failover across keys and providers, with cooldowns for models that keep failing.
- Auto routing: fast models for quick tasks, the strongest models for complex work, or pin any model.
- Usage for each key (today, this window, last 30 days) and provider-reported quota with low-quota warnings.
- Project stack detection, Python and ML guidance, and Jupyter notebooks read as clean cells.
- Manual, Auto-edit and Auto permission modes.
- Senior mode for complex builds: an environment check, stack playbooks (Flutter, web, Node.js API, Python backend, machine learning), required quality checks and a quality report.
- Always asks before system-wide installs, global packages, or changes to shell profiles and PATH.
- A warning when a complex task falls back to a weak model, and each key's last error in Settings.
- Chat history, saved on your computer only after you say yes. Reopen, search and delete past chats from the new History button.
- Automatic recovery: when every model is rate-limited or the connection drops, the task waits and resumes by itself instead of stopping.
- Instant local code search: a `search_code` tool, plus the most relevant files attached to complex tasks. No API calls, no quota used.
- "Limits across your keys": provider-reported limits added up across all your keys, with suggestions on when and which keys to add.
- A local error log in Settings → Logs, with what was fixed automatically, and Copy diagnostics with keys and personal paths removed.
- Redesigned Settings with tabs and a clearer settings icon.
- Attachments: paste, drop or attach screenshots, PDFs (including scanned), Word, PowerPoint, Excel and long text. A vision model reads images and scanned pages first; very long documents are summarized and saved for the agent to read.
- Correction mode: "Point out a fix" under each reply, or describe what's wrong. Each point is fixed with the smallest change and verified separately.
- Memory: lessons learned from your corrections (or "remember that …") are followed in future tasks, and can be reviewed, added or deleted in Settings → Memory.
- Overview: prompts left today from provider-reported limits, project status, 7-day efficiency and on/off switches for every feature.
- Clearer notices that API keys stay on your device, encrypted in VS Code Secret Storage.
