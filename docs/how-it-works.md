# How FreeAgentCoder works

How a message in the chat panel becomes checked, working code: what decides the
shape of a task, what the model is told, which models run it, how the work is
verified, and what happens when something fails.

Written for developers working on this repo. Every rule below is in the code;
the links point at the exact place.

---

## The short version

```
 your message
     │
     ▼
 ┌─────────────────────────────────────────────────────────┐
 │ controller.ts — plan the turn                           │
 │  tier (fast / deep) · playbooks · project checks        │
 │  brief + lessons + relevant files + structure map       │
 │  model chain · limit forecast                           │
 └─────────────────────────────────────────────────────────┘
     │  TurnPlan
     ▼
 ┌─────────────────────────────────────────────────────────┐
 │ session.ts — run the turn, recover from failures        │
 └─────────────────────────────────────────────────────────┘
     │
     ▼
 ┌─────────────────────────────────────────────────────────┐
 │ @agentic/core Agent — the loop                          │
 │  model call → tool calls → results → repeat             │
 │  permissions · context compaction · completion review   │
 └─────────────────────────────────────────────────────────┘
     │            ▲
     │            │ every model call goes through
     ▼            │
 ┌─────────────────────────────────────────────────────────┐
 │ ModelRouter — your keys, in order, with failover        │
 └─────────────────────────────────────────────────────────┘
     │
     ▼
 checked result in the panel
```

Two halves, on purpose:

- **`packages/core`** is the engine: the agent loop, the tools, the router. It
  knows nothing about VS Code.
- **`freeagentcoder`** is the extension: it decides *what kind of task this is*,
  builds the prompt, picks the models, and shows everything in the panel.

---

## Where the code lives

| Path | What it does |
| --- | --- |
| [packages/core/src/agent/agent.ts](../packages/core/src/agent/agent.ts) | The loop: model call, tool calls, nudges, approvals, completion review |
| [packages/core/src/agent/context.ts](../packages/core/src/agent/context.ts) | Keeping the conversation inside the models' limits |
| [packages/core/src/agent/permissions.ts](../packages/core/src/agent/permissions.ts) | What runs on its own, what asks first, what is refused |
| [packages/core/src/providers/router.ts](../packages/core/src/providers/router.ts) | The key chain, failover, cooldowns, learned size limits |
| [packages/core/src/tools/](../packages/core/src/tools/) | Read, write, edit, glob, grep, list, code search, todos |
| [packages/core/src/node/](../packages/core/src/node/) | Shell, background processes, URL fetch, toolchain check |
| [freeagentcoder/src/controller.ts](../freeagentcoder/src/controller.ts) | Turns a message into a `TurnPlan`; owns keys, usage, settings, health |
| [freeagentcoder/src/agent/session.ts](../freeagentcoder/src/agent/session.ts) | Runs a turn, streams events to the panel, retries after failures |
| [freeagentcoder/src/agent/catalog.ts](../freeagentcoder/src/agent/catalog.ts) | Task classification and the model chain per tier |
| [freeagentcoder/src/agent/playbooks.ts](../freeagentcoder/src/agent/playbooks.ts) | Stack playbooks and their quality gates |
| [freeagentcoder/src/agent/projectChecks.ts](../freeagentcoder/src/agent/projectChecks.ts) | Detects how *this* project is built and tested |
| [freeagentcoder/src/agent/testing.ts](../freeagentcoder/src/agent/testing.ts) | Test mode, and the "checked since your last edit" gate |
| [freeagentcoder/src/agent/recovery.ts](../freeagentcoder/src/agent/recovery.ts) | Which failures are waited out, and how each one is explained |
| [freeagentcoder/src/usage/forecast.ts](../freeagentcoder/src/usage/forecast.ts) | Whether today's limits cover this task, and what you saved |
| [freeagentcoder/src/webview/app/](../freeagentcoder/src/webview/app/) | The panel (no framework; plain TypeScript and CSS) |

The panel and the extension host only ever exchange the message types declared
in [shared/protocol.ts](../freeagentcoder/src/shared/protocol.ts).

---

## One turn, end to end

1. **The request arrives.** `Controller.send()` checks that a folder is open and
   a key is usable, and handles `remember that …` with no model call.
2. **The tier is decided** (below). It sets how much work the turn gets.
3. **The model chain is built** for that tier from your keys, and the router is
   pointed at it.
4. **The project's own checks are detected** (complex tasks only), cached for 60
   seconds.
5. **The prompt is assembled**: brief, structure map, lessons, relevant files.
6. **The limits are forecast.** If today's remaining requests look too small for
   the task, it still starts, with a warning card first.
7. **Attachments are read** inside the turn, so progress shows and Stop works.
8. **The agent loop runs** until the model stops calling tools.
9. **The completion review** can send it back to work.
10. **The turn is recorded**: usage, health, history, and lessons if it was a
    correction.

---

## 1. What kind of task is this?

Everything downstream follows from the tier.

| Tier | Meaning | Typical work |
| --- | --- | --- |
| `fast` | One thing, quickly | A question, a rename, a one-line fix |
| `deep` | Multi-step, verified | Builds, debugging, corrections, tests, anything with attachments |

[`classifyTask()`](../freeagentcoder/src/agent/catalog.ts) reads the request in
this order: a follow-up (`yes`, `continue`) keeps the previous tier; a short file
operation is fast; over 60 words is deep; a small edit with at most one
complexity word is fast; two or more complexity words is deep; a short question
is fast; one complexity word is deep; 12 words or fewer is fast; otherwise deep.

Four things force `deep` regardless: a pinned model, a correction, any
attachment, and a test run.

A `deep` turn gets project checks, a structure map at the start of a chat, a
playbook brief, relevant-file search, a verification gate before it may finish,
and a bigger request estimate in the forecast.

---

## 2. What the model is actually told

Layered. The system prompt is built once per session; the rest is per turn.

| Layer | Where from | When |
| --- | --- | --- |
| Engine system prompt | [core/agent/prompt.ts](../packages/core/src/agent/prompt.ts) | Always |
| Editor instructions (speed, ML rules, reply format) | [instructions.ts](../freeagentcoder/src/agent/instructions.ts) | Always |
| `AGENTS.md` / `CLAUDE.md` from the project | core prompt env | When the file exists |
| Playbook brief (stack plus required gates) | [playbooks.ts](../freeagentcoder/src/agent/playbooks.ts) | Senior mode, deep, not a follow-up |
| Correction brief (point by point, smallest fix) | [correction.ts](../freeagentcoder/src/agent/correction.ts) | Corrections |
| Test brief (run checks, change nothing, report) | [testing.ts](../freeagentcoder/src/agent/testing.ts) | Test runs |
| Project structure map | [projectChecks.ts](../freeagentcoder/src/agent/projectChecks.ts) | First deep turn of a chat, and test runs |
| Lessons from earlier corrections | [memoryStore.ts](../freeagentcoder/src/memory/memoryStore.ts) | Up to 8, ranked by word overlap |
| Likely relevant files | local BM25 index | Deep, not a follow-up |
| Attachment text and images | [attachments/](../freeagentcoder/src/attachments/) | When files are attached |

The editor instructions are deliberately compact: they are resent on every model
call, and some free tiers cap a request at about 6.5K tokens.

**Relevant files** come from a local BM25 index over the project
([tools/search.ts](../packages/core/src/tools/search.ts)): identifiers split on
case and underscores, ranked per chunk. The top 8 hits are listed as
`path:start-end` for the agent to read. It costs no API quota, and the agent can
search again itself with `search_code`.

---

## 3. Which models run it

[`planRoute()`](../freeagentcoder/src/agent/catalog.ts) builds an ordered chain
of `provider · model · key` steps for the tier:

- **fast:** Groq → Cerebras → Gemini → Mistral → OpenRouter
- **deep:** Gemini → Mistral → Cerebras → OpenRouter → Groq
- paid keys (Anthropic, OpenAI) are used only when present, after the free ones

Within a provider, keys are ordered by how many requests they have already used
today, so load spreads across them.

The [`ModelRouter`](../packages/core/src/providers/router.ts) walks that chain on
every call:

- A model that fails **transiently** goes on a cooldown — 30s for server errors,
  15s for network, 60s for a bad request — doubling per consecutive failure,
  capped at 5 minutes, while the next model takes over.
- A **rate-limited** model is parked for the longer of its `retry-after` and
  `15s × 2^(streak-1)` when something else can answer. If nothing else can, the
  wait is served in place.
- A provider that rejects a request as **too large** teaches the router that
  model's real size limit for the rest of the session.
- If everything fails, it raises `AllProvidersFailedError` listing each model and
  its reason. That text is what the recovery layer reads.

Separate chains exist for jobs that need a particular ability: the screenshot
reader and the scanned-PDF reader use vision-capable models only
([visionRoute.ts](../freeagentcoder/src/agent/visionRoute.ts)), and the lesson
writer uses the fast chain. **Settings → Health** shows each of these jobs with
the live state of every key and model serving it.

---

## 4. The agent loop

[`Agent.run()`](../packages/core/src/agent/agent.ts) is one loop per turn:

```
step → manage context → stream a model call
     → no tool calls?  → nudge / completion review / done
     → tool calls?     → validate args → permission check
                       → run, streaming output → append results → next step
```

Guard rails, all in that file:

| Guard | Rule |
| --- | --- |
| `maxSteps` | 80 model calls per turn, then it pauses |
| Nudges | Up to 2: announced an action without doing it, an empty reply, or a reply cut off by the output limit |
| Repeat guard | The same tool call three times in a row gets told to try something else |
| Tool results | Truncated in the middle at 30,000 characters |
| Text tool calls | A model that writes a tool call as text instead of calling it is recovered ([textcalls.ts](../packages/core/src/agent/textcalls.ts)) |
| Completion review | Asked at most twice per turn (see §6) |

**Tools:**

| Tool | Purpose |
| --- | --- |
| `read_file`, `write_file`, `edit_file` | Files, with a read-before-write tracker and checkpoints for undo |
| `glob`, `grep`, `list_dir` | Find files and code |
| `search_code` | Ranked local search over the project index |
| `run_command`, `process` | Shell commands, including background jobs |
| `fetch_url` | Read a URL |
| `inspect_environment` | Check which toolchains exist before building |
| `todo_write` | The plan shown live in the panel |

**Permissions** ([permissions.ts](../packages/core/src/agent/permissions.ts)) are
evaluated per call, by kind (`read`, `write`, `exec`, `network`, `meta`):

- `ask` — every write, command and network call is confirmed
- `auto-edit` — edits inside the project run on their own; commands still ask
- `auto` — everything runs except what is refused outright

Read-only commands are recognized and allowed. A command matching the dangerous
list is refused with a reason in every mode, and the agent is told not to retry
it. Approving a command can also remember its prefix for the session.

---

## 5. Keeping the conversation small

Free tiers have small context windows, so this matters more here than in a paid
agent. Two stages, cheapest first
([context.ts](../packages/core/src/agent/context.ts)):

1. **Micro-compaction** (no model call), above 70% of the limit: blank out old
   tool outputs and bulky arguments in old tool calls, and drop images from
   earlier requests, leaving a note naming them. The agent can re-read anything.
2. **Summary compaction**, above the limit: a model summarizes everything except
   a verbatim tail (25% of the limit, or 10% when forced), and the turn continues
   from that summary.

The limit is the smaller of 60K tokens and 85% of the largest model's budget. If
a provider still rejects the request as too large, the turn compacts **once**
more and retries instead of failing — the `ContextTooLargeError` path in both the
loop and [session.ts](../freeagentcoder/src/agent/session.ts).

---

## 6. Proving the work

Two independent mechanisms, both ending in `reviewCompletion`, which can hand the
model a message instead of letting it finish.

**Playbook gates** — when senior mode is on and a stack is recognized (Flutter,
web app, Node API, Python backend, machine learning, or the generic project
playbook). Each gate has a command, a regex that recognizes equivalents, and a
requirement: `always`, `release` (only when the request is about shipping), or
`optional`. `evaluateGates()` matches what actually ran against those gates, and
a required gate that did not pass sends the turn back to work.

**The project's own checks** — for every other complex task. `detectChecks()`
reads the project and returns real commands: npm/pnpm/yarn scripts, `pytest`,
`ruff`, `mypy`, `flutter analyze`, `cargo`, `go test`, `dotnet`, Maven or Gradle,
using the project's own package manager and virtualenv. Then
[`verificationReview()`](../freeagentcoder/src/agent/testing.ts) enforces one
rule:

> If a complex task changed code, it may not finish until one of the project's
> checks has passed **after its last edit**.

Edits and command runs are sequence-numbered within the turn, so "after the last
edit" is exact. A check that *failed* after the last edit is reported back with
its output. Documentation-only changes don't trigger it, and a reply that plainly
explains why no check can run (not installed, missing dependencies) is accepted
instead of looping.

**Test mode** (`Test my project`) turns every detected check into a required
gate, forbids file edits, and asks for a report in plain words: what passed, what
failed, why, and how to fix it. For ML projects the brief requires a smoke run —
one batch or a tiny sample — never a full training run.

---

## 7. When something fails

A ladder, from cheapest to most visible:

| Layer | Handles | Behaviour |
| --- | --- | --- |
| Router | One model rate-limited, erroring or offline | Cooldown, next model in the chain; invisible to the user |
| Router | Rate limit with no alternative | Waits in place when the wait is short enough |
| Loop | Request too large for every model | Compacts once, retries |
| Turn ([recovery.ts](../freeagentcoder/src/agent/recovery.ts)) | Everything transient failed at once | Waits 30s, then 90s, resuming the task; at most twice |
| Turn | Daily limit reached | No waiting: the key is set aside until it resets and the next key takes over |
| Panel | Nothing left to try | `explainError()` writes a plain title and next step; the raw text is folded into "Technical details" |

`recoveryFor()` deliberately excludes daily limits from waiting: a per-day quota
will not come back in 90 seconds, so waiting only delays the real message.
`isDailyLimit()` recognizes the wording each provider uses — Gemini's `…PerDay…`
quota metrics, Groq's `tokens per day (TPD)`, OpenRouter's `free-models-per-day`.

Anything recovered is written to the error log with what was done about it, and
counted in **Health → Recovered today**.

---

## 8. Limits, forecasts and savings

[forecast.ts](../freeagentcoder/src/usage/forecast.ts) is pure and unit-tested.

**Will this task fit in what's left today?**

```
expected requests = your history (after 3 tasks of that tier), else 3 fast / 12 deep
                    × 1.5  if it's a build or a test run
                    + 2    if there are attachments
                    × 0.8  if it's a correction
```

compared against the requests left today, worked out from the rate-limit headers
providers return ([quota.ts](../freeagentcoder/src/keys/quota.ts)):

- fewer left than needed → **short**: "Your keys may run out before this task
  finishes", with an Add a key button, shown *before* the work starts
- fewer than twice what's needed → **tight**
- when some keys report no limit at all → only a clear shortfall is flagged,
  because the unseen capacity is real

**Savings** price the tokens your free keys used against a typical paid coding
model ($3 per million in, $15 per million out). Paid keys are excluded — that
money was actually spent — and the basis line sits next to the number, so it
reads as the estimate it is.

---

## 9. Memory and learning

After a correction, a fast model turns what you said into short, general lessons
(`LEARN_SYSTEM` in [correction.ts](../freeagentcoder/src/agent/correction.ts)) —
"Use Riverpod for state, not setState" — scoped to the project or to all
projects. `remember that …` writes one directly, with no model call.

Lessons live on this machine, redacted for secrets and for paths outside the
project, and near-duplicates are merged. Up to 8 are added per turn, ranked by
word overlap with the request with recency breaking ties. They are instructions
in a prompt; nothing is retrained, and **Settings → Memory** lists and deletes
them.

---

## 10. Attachments

Screenshots, PDFs, Word, PowerPoint, Excel and long pasted text are read *before*
the task starts, so every model in the chain works from the same details even
when it can't see images.

- Office files and text are parsed locally ([attachments/](../freeagentcoder/src/attachments/)).
- PDFs with a text layer are extracted locally with pdf.js. That library is built
  as its own `dist/pdf.js` and loaded only when a PDF is attached, which keeps
  the panel fast to open.
- Scanned PDFs and screenshots go to a vision model first.
- Very long documents are summarized, with the full text saved under
  `.freeagentcoder/attachments/` (git-ignored) so the agent can read the parts it
  needs.

---

## 11. State and privacy

| What | Where |
| --- | --- |
| API keys | VS Code Secret Storage (the OS keychain), never in settings or files |
| Usage, health counters, lessons, features | `globalState` on this machine |
| Chat history | On disk in the extension's storage, only when you turn it on |
| Error log | In memory and on disk, redacted |

There is no FreeAgentCoder server. Keys go straight from your machine to the
provider they belong to, and no telemetry is collected — which is also why Health
reports *this computer's* models rather than a fleet.

---

## 12. Extending it

- **A tool:** implement `Tool` in [core/tools/types.ts](../packages/core/src/tools/types.ts)
  (`prepare()` returns a preview plus a `run()`, so permissions can be decided
  before anything happens), then register it where the agent is built.
- **A stack playbook:** add a `Playbook` to
  [playbooks.ts](../freeagentcoder/src/agent/playbooks.ts) with detection files
  and gates. Give every gate a `matches` regex that recognizes the equivalent
  commands people really type.
- **A project check:** add detection to
  [projectChecks.ts](../freeagentcoder/src/agent/projectChecks.ts) and a case to
  its test file. Check the command runs in **both** Git Bash and PowerShell on
  Windows — that is why the virtualenv check is `.venv/Scripts/python` and the
  Gradle one is `./gradlew.bat`.
- **A provider:** add a preset in
  [core/providers/presets.ts](../packages/core/src/providers/presets.ts) (most
  speak the OpenAI or Anthropic wire format), add it to the tier orders in
  [catalog.ts](../freeagentcoder/src/agent/catalog.ts), and add its key format and
  sign-up link to [keyFormat.ts](../freeagentcoder/src/shared/keyFormat.ts).
- **A panel message:** add it to the union in
  [protocol.ts](../freeagentcoder/src/shared/protocol.ts) first; both sides are
  type-checked against it.

---

## 13. Tests

```bash
cd packages/core   && npx vitest run     # 186 tests — engine
cd freeagentcoder  && npm run test:unit  # 55 tests — checks, forecasts, recovery, test mode
cd freeagentcoder  && npm run compile    # both type-check projects, eslint, bundles
```

Anything with real logic and no `vscode` import is unit-tested. That is why
`recovery.ts`, `forecast.ts`, `testing.ts` and `projectChecks.ts` are separate
modules rather than methods on the controller or the session.

---

## 14. Deliberate limits

Worth knowing before changing something to "fix" it:

- **One key per account, one account per provider.** Extra accounts to dodge free
  limits breach provider terms, so the app never suggests it; it suggests a
  different provider instead.
- **No promise of "unlimited" or "never fails."** Free tiers have limits; the
  app's job is to warn early, spread load, and explain clearly when it stops.
- **Health is local.** Cross-user stats would need a server and telemetry.
- **Checks are detected, not verified.** A check is reported when its config
  exists; whether the tool is installed is found out when it runs.
- **Node checks come from the root `package.json`.** Scripts that live only in a
  workspace package aren't found yet.
