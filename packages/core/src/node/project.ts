import { existsSync, promises as fs } from 'node:fs';
import * as path from 'node:path';

/** Instruction files other agents use too, so existing repos work out of the box. */
export const INSTRUCTION_FILES = ['AGENTS.md', 'AGENTIC.md', 'CLAUDE.md', '.github/copilot-instructions.md', '.cursorrules'];

const MAX_INSTRUCTIONS = 12_000;

export async function loadProjectInstructions(root: string): Promise<{ file: string; content: string } | null> {
  for (const name of INSTRUCTION_FILES) {
    const file = path.join(root, name);
    try {
      const content = await fs.readFile(file, 'utf8');
      if (content.trim()) {
        return {
          file: name,
          content: content.length > MAX_INSTRUCTIONS ? `${content.slice(0, MAX_INSTRUCTIONS)}\n…(truncated)` : content,
        };
      }
    } catch {
      // not present
    }
  }
  return null;
}

export function isGitRepo(root: string): boolean {
  let dir = path.resolve(root);
  for (;;) {
    if (existsSync(path.join(dir, '.git'))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

export const INIT_PROMPT = `Create an AGENTS.md file in the project root that will help AI coding agents work in this repository. First explore: read the README, package/dependency manifests, build and test configuration, and a few representative source files. Then write a concise AGENTS.md (under ~60 lines) covering:
- What the project is, in one or two sentences.
- How to install, build, run, test and lint it (exact commands).
- The layout: the important folders and what lives where.
- Code conventions that aren't obvious from a quick look (style, patterns, libraries to use or avoid).
- Gotchas: environment variables, generated files not to edit, anything surprising.
Only include what you verified in the code. If AGENTS.md already exists, improve it instead of replacing useful content.`;
