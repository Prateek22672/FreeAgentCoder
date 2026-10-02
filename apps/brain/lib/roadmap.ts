import { store } from './kv';

/**
 * The admin's working list: what to do now, what to build next, what to test
 * and verify, where to research, and what lies further out. The items below
 * are the starting list; ticks, notes and added items are kept in the store,
 * so they survive deploys and are the same on every device.
 */

export type RoadmapGroup = 'now' | 'todo' | 'test' | 'verify' | 'research' | 'future';

export interface RoadmapItem {
    id: string;
    group: RoadmapGroup;
    title: string;
    detail?: string;
    /** Where it lives or how to check it. */
    where?: string;
}

export interface RoadmapState {
    done: Record<string, number>;
    notes: Record<string, string>;
    added: RoadmapItem[];
    removed: string[];
}

export const GROUPS: { id: RoadmapGroup; title: string; blurb: string }[] = [
    { id: 'now', title: 'Do now', blurb: 'Release steps and anything blocking users today.' },
    { id: 'verify', title: 'Verify reported issues', blurb: 'Fixed in code; confirm on the live site or a real install, then tick.' },
    { id: 'test', title: 'Test next', blurb: 'What to try by hand before and after the next release.' },
    { id: 'todo', title: 'Build next', blurb: 'The next version, in rough order.' },
    { id: 'research', title: 'Research directions', blurb: 'Questions worth measuring before building more.' },
    { id: 'future', title: 'Future scope', blurb: 'Bigger bets, later.' },
];

export const DEFAULT_ITEMS: RoadmapItem[] = [
    // Do now
    { id: 'publish-050', group: 'now', title: 'Publish FreeAgentCoder 0.5.0 to the Marketplace', detail: 'Includes everything from the unpublished 0.4.2. Live is 0.4.0 (1 Oct).', where: 'freeagentcoder/freeagentcoder-0.5.0.vsix' },
    { id: 'open-vsx', group: 'now', title: 'Publish the same VSIX on Open VSX', detail: 'Cursor, Windsurf, VSCodium and Gitpod install from Open VSX, not the Marketplace: free reach to exactly the people searching for alternatives.', where: 'npx ovsx publish freeagentcoder-0.5.0.vsix -p <token>' },
    { id: 'rank-check', group: 'now', title: 'Re-check Marketplace search ranks a few days after publishing', detail: 'Before 0.5.0: cursor alternative 1, free ai coding agent 3, copilot alternative 3, claude code alternative 5, windsurf alternative 42, cline alternative 77, roo/kilo code alternative >100. The new keywords target the last four.' },
    { id: 'site-deploy', group: 'now', title: 'Confirm the latest site deploy is green', where: 'GitHub commit status / Vercel' },

    // Verify reported issues
    { id: 'v-splash', group: 'verify', title: 'Splash plays smoothly on a first visit and completes', detail: 'Now one CSS timeline decided before the first paint: editor types, folds into the mark, locks, opens (~5 s). Click or a key skips. Not shown when coming from another page of the site, on Back, or with reduced motion. Checked live 2 Oct: plays 0.8–5.0 s on arrival, off from a link and on Back/Forward. Left to confirm by eye: smoothness on your own machine.' },
    { id: 'v-caret', group: 'verify', title: 'Hero headline types with the caret right after each letter', detail: 'Was: a lone caret far right before typing began.' },
    { id: 'v-pill', group: 'verify', title: '"Get started free" pill appears only from the Fyx frame on', detail: 'And steps aside near the final call to action and the footer. Checked live 2 Oct: hidden on the hero and 1.2 screens down, shown once the Fyx frame is half way up.' },
    { id: 'v-cover', group: 'verify', title: 'The agent panel no longer covers the hero text', detail: 'Text it would cover fades out while it does (short screens and during the flight).' },
    { id: 'v-jump', group: 'verify', title: 'The Fyx frame no longer jumps as its words change', detail: 'Checked live 2 Oct: one height (788 px at 1920×925) across the slides.' },
    { id: 'v-black', group: 'verify', title: 'No black empty screen after the Fyx frame', detail: '"Understand, then build" now slides in while it scrolls into view. Checked live 2 Oct: the words are at 66% opacity when the section is half in view.' },
    { id: 'v-strip', group: 'verify', title: 'No light strip between frames while scrolling', detail: 'The 3D lean now moves the card, not the full-width section.' },
    { id: 'v-snake', group: 'verify', title: 'Re-run the friend’s snake & ladder test on 0.5.0', detail: 'It burned ~1.4B tokens and left files missing on 0.4.0. Expect plain HTML/CSS/JS in a few steps, a passing page check, a preview, and far fewer tokens.', where: 'Admin → Test lab' },

    // Test next
    { id: 't-errors', group: 'test', title: 'Editor errors after an edit', detail: 'Ask for a change that breaks a TypeScript file: the edit result should list the new error and the agent fix it straight away. Try Python (Pylance) too. A file type with no language server must not slow edits (skipped after two silent tries).' },
    { id: 't-fix', group: 'test', title: '"Fix with FreeAgentCoder" quick fix', detail: 'Light bulb on an error → task starts with file and line. While a task runs, the request waits in the input instead.' },
    { id: 't-mention', group: 'test', title: '@-mentions in the chat', detail: 'Type @, pick with arrows/Enter; the mentioned file is edited without a read_file first; a long file is only partly included.' },
    { id: 't-ask', group: 'test', title: 'Right-click "Ask FreeAgentCoder About This"', detail: 'Puts `path:lines` in the input with the caret after it.' },
    { id: 't-preview-tab', group: 'test', title: 'Preview tabs from edits are not annoying', detail: 'One preview tab reused, focus never taken. freeagentcoder.editorErrorsAfterEdit = false turns it off.' },
    { id: 't-install', group: 'test', title: 'Fresh install opens the panel and the Get Started guide', detail: 'Uninstall, reinstall, reload.' },
    { id: 't-mobile', group: 'test', title: 'Home page on a phone and in Safari/Firefox', detail: 'Splash, typing, scroll frames, floating pill; Read a repo chips are tappable (no tilt or drag on touch).' },
    { id: 't-tilt', group: 'test', title: 'Read a repo: tilt and drag', detail: 'Card leans toward the pointer; a chip dragged onto the box fills it; a plain click still opens the repo.' },
    { id: 't-fyxable', group: 'test', title: 'Fyxable end to end', detail: 'Onboarding → preset layout (code | preview | agent) → build → run → download/export. Panels drag, resize, double-click to fit.' },
    { id: 't-design-eval', group: 'test', title: 'Live design eval of Fyxable sites', detail: 'Blocked earlier because the free-trial models were busy. Run with EVAL_GEMINI_KEY.', where: 'apps/brain/scripts/design-eval.mts' },

    // Build next
    { id: 'b-fold', group: 'todo', title: 'Compact old steps without a model call', detail: 'Fold old tool output into one line each before ever paying for a summary.' },
    { id: 'b-sticky', group: 'todo', title: 'Keep one provider within a turn', detail: 'Switching mid-turn loses the provider’s prompt cache; switch only on failure.' },
    { id: 'b-batch', group: 'todo', title: 'Read and edit several files in one call', detail: 'Fewer round trips, each of which resends the conversation.' },
    { id: 'b-cached', group: 'todo', title: 'Show cached tokens in Usage', detail: 'Providers already report them; the engine parses them.' },
    { id: 'b-plan-build', group: 'todo', title: 'Plan on the strong model, build on the fast one' },
    { id: 'b-restore', group: 'todo', title: 'Restore points per step', detail: 'Undo one step, not only the whole task.' },
    { id: 'b-symbols', group: 'todo', title: 'Symbol tools from the editor', detail: 'Go to definition and find references through VS Code’s language servers, instead of grep.' },
    { id: 'b-review', group: 'todo', title: 'Local /review of the current changes' },
    { id: 'b-mcp', group: 'todo', title: 'MCP servers, with tools loaded only when needed' },
    { id: 'b-remember', group: 'todo', title: 'Fyxable: remember chats in the cloud with Google sign-in', detail: 'Supabase auth; plus the Fyx popup at the top right.' },
    { id: 'b-design-data', group: 'todo', title: 'Admin: a Data tab for the design library', detail: 'Upload reference zips and fonts that feed the directions and recipes.' },
    { id: 'b-evals', group: 'todo', title: 'An eval smoke suite run before each release', detail: 'A handful of Test lab tasks with pass/fail and token budgets.' },

    // Research
    { id: 'r-tokens', group: 'research', title: 'Tokens per task, by kind', detail: 'From Test lab runs: set a budget per kind and alert when a release goes over.' },
    { id: 'r-cache', group: 'research', title: 'How much each provider’s prompt cache saves us', detail: 'Gemini implicit caching, OpenAI, Groq: measure cached vs fresh tokens per step.' },
    { id: 'r-router', group: 'research', title: 'Quick vs deep classification accuracy', detail: 'How often a quick task should have been deep (and the reverse), from corrections and retries.' },
    { id: 'r-map', group: 'research', title: 'A real repository map for deep tasks', detail: 'Parser-based outlines instead of the regex outline; worth it if it cuts exploring steps.' },
    { id: 'r-design', group: 'research', title: 'What makes Fyxable sites look professional', detail: 'Score generated sites against the design library; find which rules the model breaks.' },
    { id: 'r-competitors', group: 'research', title: 'Competitor watch', detail: 'Cline, Roo Code, Kilo Code, Continue, Copilot agent mode: what they ship, what users complain about.' },

    // Future
    { id: 'f-cli', group: 'future', title: 'Release the engine as a CLI', detail: 'The same agent in a terminal, on the same free keys.' },
    { id: 'f-jetbrains', group: 'future', title: 'JetBrains plugin' },
    { id: 'f-deploy', group: 'future', title: 'Fyxable: one-click deploy to Vercel or Netlify' },
    { id: 'f-team', group: 'future', title: 'Shared team memory and settings' },
    { id: 'f-domain', group: 'future', title: 'Custom domain for the site', detail: 'Deferred; currently brain-rho-roan.vercel.app.' },
];

const KEY = 'pb:roadmap:v1';
const TEN_YEARS = 10 * 365 * 24 * 60 * 60;

export async function readRoadmap(): Promise<RoadmapState> {
    const [raw] = await store.getMany([KEY]);
    try {
        const parsed = raw ? (JSON.parse(raw) as Partial<RoadmapState>) : {};
        return { done: parsed.done ?? {}, notes: parsed.notes ?? {}, added: parsed.added ?? [], removed: parsed.removed ?? [] };
    } catch {
        return { done: {}, notes: {}, added: [], removed: [] };
    }
}

export async function writeRoadmap(state: RoadmapState): Promise<void> {
    await store.put(KEY, JSON.stringify(state), TEN_YEARS);
}

/** The starting list plus added items, without removed ones. */
export function roadmapItems(state: RoadmapState): RoadmapItem[] {
    const gone = new Set(state.removed);
    return [...DEFAULT_ITEMS, ...state.added].filter((item) => !gone.has(item.id));
}
