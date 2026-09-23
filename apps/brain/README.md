# Project Brain

The website half of FreeAgentCoder: connect a repository and understand it
before changing it. The VS Code extension is the half that makes the changes.

Public GitHub repositories, no sign-in, no database. A repository is analyzed in about 1–4 seconds.

## Run it

```bash
npm install          # from the repository root
npm run brain        # http://localhost:3000
```

Search, architecture and impact analysis need nothing else. **Ask** gives each
visitor two free questions a day on the site's key, then asks them for their own
free key (kept in their browser, used for one request, never stored here). To
provide the trial, copy `.env.example` to `.env.local` and add one free key:

```bash
GEMINI_API_KEY=...   # free at https://aistudio.google.com/apikey
```

Or point it at a model on your own machine, so code never leaves it:

```bash
BRAIN_OPENAI_BASE_URL=http://localhost:11434/v1   # Ollama
BRAIN_OPENAI_MODEL=qwen3-coder:30b
```

## What it does

| Tab | What you get | Needs a key |
| --- | --- | --- |
| Overview | Stack, languages, data layer, testing, package manager — each with the file it was read from | No |
| Architecture | The layers the repository actually has, with example files | No |
| Ask | Answers that cite real files and line ranges; invented paths are flagged | Yes |
| Search | Ranked search over the code (the same BM25 index the extension uses) | No |
| Impact & plan | What a change touches — direct hits, files reached through imports, risk — and a step-by-step plan | No |
| Work on this in VS Code | Hands the plan to the FreeAgentCoder extension, written into its chat (nothing runs until you press Send) | No |
| Dependencies | Every manifest in the repository, including sub-projects | No |
| Files | Folder tree and path search | No |

Every finding is labelled **detected** (read from the repository), **inferred**
(deduced from strong signals) or **estimated** (a heuristic).

The results open in a VS Code-style workbench: explorer, editor tabs with syntax-highlighted code, one command box (Ctrl K) to ask, search or describe a change, and a status bar. Every file opens at the cited lines; **What depends on this** shows everything that imports a file.

Deep links work: `/r/owner/repo?tab=impact&q=Replace%20Prisma%20with%20Drizzle`.

## How it is built

```
apps/brain                 Next.js 15 app: pages and API routes
  lib/github.ts            read-only GitHub access: lists files first, then races the archive
                           against per-file downloads (binary-heavy repos skip the archive)
  lib/tar.ts               streaming tar reader: filters by header, before bytes arrive
  lib/store.ts             ingested repositories, in memory, 1 hour
  lib/ai.ts                model chain — packages/core's router, failover and presets
  app/api/*                analyze · search · ask · impact · file
packages/project-brain     pure analysis, no I/O: detection, structure, imports,
                           impact, grounding, ranking, and the versioned task handoff
                           (task.ts) that the VS Code extension also imports.
packages/core              unchanged: CodeIndex, MemoryWorkspace, ModelRouter
```

## Security model

- **Nothing from the repository is executed.** It is downloaded (one archive, or only its text files) and read as text.
- **Binaries, dependencies and build output are filtered from the tar header**, so a committed dataset never enters memory. Hard caps: 512 KB per file, 4,000 files, 32 MB of text, 250 MB repository.
- **Repository text is data, not instructions.** Excerpts go to the model fenced in labelled blocks, never in the system prompt, and the prompt says so.
- **Every cited path is checked** against the files that were actually read. Invented ones are shown as such.
- **Secrets stay out of model requests.** `.env` files and files with credential patterns are excluded from evidence, and anything credential-shaped in the rest is redacted before it leaves the server.
- **Keys live on the server** (`server-only` modules). The browser sees answer text, never a key or a GitHub token.
- **Inputs are validated with GitHub's own naming rules**, shared by the form and the server; the file endpoint serves only ingested paths.
- **Model output is rendered as React elements**, never as HTML.

## Tested

- `packages/project-brain/test` — 43 unit tests, including regressions found on real repositories and every way a handoff link can be tampered with.
- End to end against `expressjs/express`, `fastapi/full-stack-fastapi-template` and `shadcn-ui/taxonomy`: every endpoint, streaming, citation grounding, secret exclusion, bad input.
- A real browser (Chrome over the DevTools protocol) on every tab, desktop and phone: content renders, no console errors, no horizontal overflow.

## Search

Every page carries its own title, description, canonical URL and structured data
(`SoftwareApplication`, `WebApplication`, `FAQPage`, `TechArticle`). `sitemap.xml`
and `robots.txt` are generated; live analyses under `/r/` are `noindex`, since they
are personal and last an hour. Ten guide pages target the searches people actually
make — see `lib/articles/`. Deployment: `docs/DEPLOY-project-brain.md`.

## Not yet

- Private repositories and sign-in (GitHub OAuth) — checkpoint 2.
- Saving analyses (PostgreSQL) — checkpoint 2.
- Project rules (constitution) and AI-refined plans — checkpoint 3.
