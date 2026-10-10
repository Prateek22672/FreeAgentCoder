# Changelog

## 0.6.0 — Knows more, wastes less

### Added

- **A reference library.** Complex tasks now start from how strong solutions of that kind are built: blueprints (an ASP.NET Core CRM with central audit and per-user data, role-based backends) and design references (the visual systems of real sites). The library is kept on our site, grows from the admin page, and is downloaded once a day; matching happens on your computer, so nothing about your request is sent.
- **Current library documentation.** A new library_docs tool looks up up-to-date documentation and examples for any library (from Context7), sending only the library name and the topic. The agent checks an API before guessing, and when a library rejects a call.
- **A code map for existing projects.** The first step of a complex task lists the files the rest of the project uses most, with their main definitions, so the agent opens the right files first instead of exploring.
- **Settings → Learning** replaces Memory. It shows what FreeAgentCoder has learned from your tasks (lessons from your corrections and chores Fyx now does itself), how much it saved, and your corrections week by week, so you can see whether each task goes better than the last. Forget anything with one click.
- **Edits by line number.** The agent can now replace lines 40-55 instead of retyping the old text exactly, which removes most "old_string was not found" retries. Numbers are only trusted while they still point where they did.
- **NVIDIA as a free provider.** A free key from build.nvidia.com adds Kimi K3, Nemotron 3 Ultra and GLM 5.3 for complex tasks (right after Gemini) and GLM 5.3 Flash for quick ones. Keys starting nvapi- are recognised when pasted.
- **Building from a requirements document.** Attach a spec (PDF, Word) and FreeAgentCoder works like an engineer delivering against it: a REQUIREMENTS.md checklist before any code, the stack the document names, shared security and validation built first, demo logins per role, every acceptance step checked with real commands, and an EXPLAIN.md mapping each requirement to the code.
- **Proven structures for common projects.** For ASP.NET Core business apps and role-based backends, the task now starts from how strong solutions are put together (central audit logging, one row-level access filter, validation on client and server). A .NET playbook checks the SDK and requires dotnet build to pass.
- **Documents and presentations.** Requests for slides, PDFs and reports now follow a proven recipe: one build script, correct colours for python-pptx and matplotlib, paths that work from any folder, a PDF without LibreOffice, and a check of every slide.

### Improved

- **Every Gemini model on your key is used before work moves elsewhere.** Google's free limits are per model, so when Gemini 3.8 Flash is busy or out of quota, Gemini 3.7, 3.6, 3.5 and 2.5 Flash carry on on the same key. Groq has a second model too. Gemini's token use now shows in Usage (it was missing, which made it look unused).
- **A repeated error gets fixed at its cause.** When the same error comes back (even with other steps in between), the next steps go to the strongest model you have, with an instruction to find the root cause and fix every place it comes from, instead of patching one line at a time. If it still comes back five times, the task stops instead of burning tokens.
- **Stronger models first on big tasks.** OpenRouter's free router, which hands each request to whichever free model is idle, is now the last resort for every task, after Groq and Cohere.
- **Fewer pauses.** A task that is still changing files or running commands successfully carries on past the token limit, up to twice it, instead of stopping halfway. Tasks that are only going round in circles still pause.
- **No more stalls over optional tools.** A Python project no longer stops to ask about uv or poetry: it uses them if installed and python -m venv otherwise.
- **Python on Windows prints any character.** Scripts that print arrows or emoji no longer crash with UnicodeEncodeError.
- **New projects start clean.** A request to make something new no longer attaches unrelated files from the folder that happen to share its words.

## 0.5.1 — Always where you left it

### Added

- **FreeAgentCoder on the left activity bar.** Its icon is always there, so the chat is one click away even when the right sidebar is closed.
- **Open in a tab.** The FreeAgentCoder button at the top right of every editor opens the chat as an editor tab beside your code. Drag it wherever you like; **VS Code reopens it after a restart**, exactly where it was.
- The left view, the right sidebar and the tab all show the same live chat, so you can switch between them mid-task.
- **FreeAgentCoder in the status bar**, bottom right: one click opens the chat.
- **No doubt that it installed.** A new install opens the chat on the left and says where FreeAgentCoder lives from now on; the Get Started guide shows all three places instead of the Command Palette.

## 0.5.0 — It sees what your editor sees

### Added

- **Edits come back with the editor's errors.** After each change, the agent is told the type, lint and syntax errors your editor now finds in that file — only the ones the change introduced — so it fixes them at once instead of finding out at the end, or never. An edited file is shown in a preview tab without taking your focus, since language servers only check open files. It costs nothing when there are no errors. `freeagentcoder.editorErrorsAfterEdit` turns it off.
- **A `get_problems` tool.** The agent can ask for the editor's errors in one file or across the project, which is much faster than running a full type check or build.
- **Fix with FreeAgentCoder.** Every error in the editor has a **Fix with FreeAgentCoder** quick fix (the light bulb, or Ctrl+.). It sends the error, with its file and line, as a task. If a task is already running, the request waits in the chat input instead.
- **Ask FreeAgentCoder About This.** Right-click a selection to put a reference to those lines (`src/app.ts:12-20`) in the chat input, ready for your question.
- **@-mention files.** Type `@` in the chat to pick a project file. Mentioned files go with your request already read, so the agent starts on them without spending a step (and a resend of the whole conversation) reading them first.

### Changed

- **Long files are read with a map.** A long file is read 500 lines at a time, and the first page starts with an outline of the whole file (its functions, classes and types, with line numbers), so the agent reads the part it needs next instead of paging through.
- Command output sent to the model is capped at 8,000 characters, keeping the start and the end, where the errors usually are.

## 0.4.2 — Small builds stay small

### Fixed

- **A small build no longer turns into a big one.** Asked for something like a browser game, the agent used to set up Vite, React, Tailwind and a test runner first, one small step at a time, and could use hundreds of thousands of tokens before writing any of the game. It now picks the simplest stack that does the job well: something that runs in a browser with no backend is plain HTML, CSS and JavaScript, written in a few steps, in its own folder (`index.html`, `css/`, `js/`). A framework is used when you name one or the app needs one.
- **The agent is no longer sent back to pass a check that cannot exist.** A task could be refused its finish until a "build or tests" check passed, even for a project with nothing to build, which sent the agent off to add a build system. A check is now required only when the project has the build or test it names.
- **Continue keeps the task's method and checks.** The Continue button used to restart the work as a quick task on the fast models.
- Token counts are right on OpenAI keys, which reported none before.

### Added

- **Web pages are run before they are called done.** A page can read well and still crash on its first line, and a model cannot tell without running it. When a task writes or changes a plain web page, FreeAgentCoder now loads it in a hidden browser (Chrome, Edge, Brave or Chromium already on your computer), and any error — with its file and line — goes back to the agent to fix before it may finish. A page that loads cleanly costs no extra tokens. The agent can also run the same check itself, mid-task. `freeagentcoder.checkPages` turns it off; with no such browser installed it is skipped.
- **A preview when the task ends.** A web page the agent made, or a dev server it left running, opens beside your code, and every finished task that made one has an **Open preview** button. A plain page is served from your own computer only (127.0.0.1), so its scripts load as they would on a real site; nothing leaves your machine. `freeagentcoder.openPreview` turns the automatic opening off.
- **A token limit per task.** A task pauses after 500,000 tokens and asks before going on, so one runaway task cannot use up a day's free allowance or a paid key. Nothing is lost: press **Continue**. `freeagentcoder.taskTokenLimit` changes the limit; `0` turns it off.

### Changed

- **Small tasks use far fewer tokens.** Measured on a typical small fix, the same steps now cost about 65% less:
  - Each request carries a lighter copy of the conversation: long tool output is cut to what is worth reading (keeping the start and the end), and a file read is dropped once the file has been read again or changed.
  - A quick task is offered only the tools it needs and asks the model to think less, so the fixed cost of every request fell from about 4,100 to 2,700 tokens. The instructions were rewritten to say the same in fewer words, and the Python section is sent only for Python projects.
  - A new request unrelated to the previous one no longer resends that task's output.
  - Quick tasks are handed the likely relevant files up front, so they spend fewer steps looking.
  - Old output is trimmed in batches rather than on every step, so the providers' prompt caches keep working.
- **A stuck model is stopped instead of burning tokens.** Five identical calls in a row, or six steps in a row where everything failed, end the task with an explanation (after advice to change approach at the third). A cut-off reply is told to be concise rather than to continue, and nudges reset whenever the agent makes progress.
- **Edits that are nearly right are applied.** When an edit differs from the file only by trailing spaces, curly quotes or dashes, or the same indentation on every line, and exactly one place fits, it is applied and the reply says so, instead of costing a retry.
- **The plan is finished.** A task that stops with open items in its plan is sent back once to finish them or say why not, and every few steps the agent is reminded where it is.
- Token estimates learn from what each provider reports, so compaction starts at the right time.
- **Settings are easier to move around.** A clear **Back** and **Done** at the top (Esc works too), the sections as a rail of icons down the left instead of a strip that scrolled sideways, and on the API Keys page your own keys come first, with the explanations after them.
- **Installing opens FreeAgentCoder.** After an install or a reinstall the panel and the Get started guide open on their own, instead of nothing appearing until you found the side bar.
- **Long tasks cost less.** Old command output and file contents the agent no longer needs are dropped from the conversation much earlier, so each step of a long task resends less. The most recent work is always kept in full.

## 0.4.1 — Test lab

- **FreeAgentCoder: Run a Test Task**, for the project's own testing. With a lab token from the admin page, it runs a fixed test task in the open folder and sends its numbers and conversation to the Test lab. Hidden unless `freeagentcoder.labToken` is set.

## 0.4.0 — Specialists, and a Plans page

### Added

- **Specialists.** Before a task starts, FreeAgentCoder works out what kind of work it is and follows the method that suits it. **Debugging** reproduces the problem before fixing it and proves the fix with a test. **Refactoring** runs the tests before and after and changes no behaviour. **Interface design** matches the project's existing components and checks phone width. **Data and ML** fixes seeds, holds data out and reports a baseline. **Building** works end to end with nothing faked. **Explaining** answers from the code and changes nothing. Each has a finish line the agent must meet before reporting done, and a short request that is really one of these is given the time it needs. You'll see the method named at the top of the task.
- Specialists can be improved without a new release: once a day the extension checks the project's site for updated instructions. It is a plain request that sends nothing about you or your project, and **freeagentcoder.specialistUpdates** turns it off.
- **Plans**, in Settings and as **FreeAgentCoder: Plans**. It shows the free tier you are on — your own keys, and the providers that give one away with no card — and, only if one has been switched on, a paid tier for when your free limits run out, with its price, its weekly quota and a button to get a licence. The page asks the project's site for this only when you open it; the free tier still makes no calls of its own. Where paid requests would go is said plainly: through FreeAgentCoder's server, unlike the free tier.

- **Fyx: everyday tasks in seconds, with no tokens.** Zipping or unzipping a folder, git (status, pull, push, commit with your message, branches, clone, fork), installing or adding packages, running your project's dev server, build or tests (including a project one folder down), creating, moving and copying files, and counting lines or sizes are now done on your machine without an AI model. Zipping a project folder used to take minutes and thousands of tokens; Fyx does it in under a second, and leaves out node_modules and .git unless you ask. Every command still asks the usual permission. Fyx learns as you go: a short request the AI agent finished with a single command is done by Fyx the next time. Anything else goes to the agent as before. `freeagentcoder.fyx` turns it off.
- **A short note after each update** says what is new, and a small note says when a newer version is out, with a button to update.
- **Keys are checked with a real request when you add them.** A key whose account needs billing or an active plan is refused with the reason, instead of failing in the middle of a task.
- **A free trial, so the first task works with no key.** Until you add a key of your own, tasks run on a daily allowance on the project's keys: about two or three real tasks a day. Those requests go through FreeAgentCoder's server, and the panel says so when they do. Add your own free key and the trial steps aside; `freeagentcoder.freeTrial` turns it off.

### Changed

- **Cohere is a new free provider.** Its trial key needs no card and allows 1,000 calls a month at 20 a minute, on Command A+. Cohere does not allow trial keys for production or commercial work, and the extension says so where you add one. It is the last free provider tried, because the monthly allowance runs out quickly.
- **Simpler key setup: Gemini, Groq and OpenRouter.** These three give free keys that work straight away. Mistral and Cohere stay as optional extras, and Mistral's free plan is explained (it must be chosen, with a verified phone number). **Cerebras is removed**: its free keys stopped working.
- **Cerebras is no longer offered as a free provider anywhere.** Some places still described it as free after 0.3.1. It is now listed with the paid providers, is never tried in the free rotation, and keys you already saved keep working.

## 0.3.1 — Honest about Cerebras

### Fixed

- **Cerebras is no longer described as a free tier**, because it is not one any more. Their documentation now says there is no permanently free tier: it is $5 of credits that need a card and expire after 30 days. The extension said otherwise in several places, which meant following its advice led to a payment wall. The providers that still need no card are Gemini, Groq, Mistral and OpenRouter.

### Changed

- The one-time question about sending anonymous counts now comes after your **first** task rather than the third. Someone who tries it once and moves on is exactly who it is worth hearing from.
- **"Get a free key" buttons** now pass through a redirect on the project's site, which counts only the provider and the day, so it is possible to tell how many people reach the point of getting a key. The provider's own address is still shown beside the button as a direct link, and the redirect never blocks the way through.

## 0.3.0 — Work on tasks from Project Brain

### Added

- **Anonymous counts, if you say yes.** Asked once, after a few tasks, and off until then: how many keys you have and which providers, how many tasks ran and how they ended, and short causes such as `gemini:daily-limit`. Never code, prompts, file names or keys. The question is skipped entirely when VS Code's own telemetry is off, and **FreeAgentCoder: Anonymous Usage Data** shows exactly what would be sent, and turns it off again.
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
