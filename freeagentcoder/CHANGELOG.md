# Changelog

## 0.1.2 — Clearer positioning

### Fixed

- The "Get a free key" button and the "Save key" button showed overlapping, cut-off text: updating a button's label replaced its icon instead. Button labels are now targeted directly.

### Changed

- New orange brand color throughout the chat panel, buttons, switches and icon.
- Adding a key: "Get a free Gemini key" (named for the selected provider) is now a clear full-width button, a pasted key selects its provider automatically, and a Paste button reads the clipboard in one click.
- Screenshots on the Marketplace page.

- Description and keywords now use the terms people actually search for ("AI pair programmer", "vibe coding", "agentic AI", "open source", "BYOK") alongside every supported provider and model name. Added a SUPPORT.md so the Marketplace page shows a support link.

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
