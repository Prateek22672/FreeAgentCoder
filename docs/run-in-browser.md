# Running a repository in the browser

Written 2026-09-29. The decision, its constraints, and what is and is not in scope.

## The decision

"Run anything online" the way Replit, Lovable or Bolt do means a sandbox per
visitor on a server you pay for — compute per minute, GPUs for anything that
calls itself ML, and the abuse that every free-compute service attracts within
days. It also inverts the one thing that makes this product free: nothing is
paid for on the user's behalf.

So the website runs code the only way that costs nothing per visitor: **inside
the visitor's own browser tab.** A Node runtime boots in the page (the
WebContainer API — the same mechanism Bolt uses), the repository's files are
mounted into it, `npm install` and the project's dev script run there, and the
dev server it starts is shown in a frame. No server executes anything.

## What it can and cannot do

| | |
|---|---|
| JavaScript and TypeScript projects with a `package.json` | **Yes** — most web apps |
| Python, Go, Rust, native binaries | **No** |
| Training or serving ML models | **No**, and no honest product should claim it |
| GPUs | No |
| Browsers | Desktop Chromium out of the box. Firefox and Safari are marked beta by the runtime's authors. Phones: no |
| Memory | Limited to what one tab can hold; very large projects are capped at 6 MB of source |

## Constraints that shaped the code

- **Cross-origin isolation.** The runtime needs `SharedArrayBuffer`, which needs
  the page served with `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`. Those headers are set for
  `/r/*` only (`next.config.mjs`), because they block cross-origin resources
  that do not opt in — the workbench pages load none, and the rest of the site
  keeps its embeds and link previews.
- **No server inference.** The agent working on a running project uses the
  visitor's own key, as everywhere else on the site. This feature never adds a
  model call the site pays for.
- **The files come from the analysis already in memory** (`/api/files`), so the
  same rule applies as to every other endpoint: only text that was ingested is
  ever served, never an arbitrary path.

## Licence — read before this becomes a production feature

The npm package `@webcontainer/api` is MIT. The *service* it connects to is
not: StackBlitz's terms say **"Licensing is required for production usage of
the API in a commercial, for-profit setting. (Prototypes or POCs do not
require a commercial license.)"**

As of this writing the product is free and unmonetised, and this is a
prototype, so no licence is needed. **Two things change that:**

1. Shipping this as a headline feature rather than a prototype.
2. **Adding any paid tier to the product** — which is planned. A paid tier makes
   the whole product "commercial, for-profit" in the plain reading of those
   terms.

Before either, get a written answer from StackBlitz (webcontainers.io/enterprise).
Do not assume a free product is exempt once money changes hands anywhere in it.

## What is deliberately not built

- A server-side sandbox of any kind.
- Deployment or hosting of the running project.
- A terminal the visitor can type into. Output is shown; commands are ours.
  Letting visitors run arbitrary commands is a support burden with no upside
  for the product's purpose, which is to show the agent's change working.

## Next steps, in order

1. Verify in a real browser: boot, mount, install, dev server, preview.
2. Wire the agent's edits into the running container so a change shows live —
   this is the Bolt loop, and the actual point of the feature.
3. The licence conversation, before either of the two triggers above.
