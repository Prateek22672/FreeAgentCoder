import { EXPLAINS_BLOCKER, type CommandRun, type Playbook } from './playbooks';
import { commandVerifies, type ProjectCheck } from './projectChecks';

export const TEST_PROMPT = 'Test my project and explain any failures.';

export interface SequencedRun extends CommandRun {
    /** Order within the task, compared with the last edit. */
    seq: number;
}

const STACK_NAMES: Record<string, string> = {
    node: 'Node.js',
    python: 'Python',
    flutter: 'Flutter',
    dart: 'Dart',
    rust: 'Rust',
    go: 'Go',
    dotnet: '.NET',
    java: 'Java',
};

/** Every check the project has becomes a required gate, so the quality report shows exactly what ran and what passed. */
export function testPlaybook(checks: ProjectCheck[]): Playbook {
    const stacks = new Set(checks.map((c) => c.stack));
    return {
        id: 'test',
        name: 'Project checks',
        request: /(?!)/,
        projectFiles: [],
        toolchains: [],
        guide: [],
        gates: checks.map((check) => ({
            id: `${check.stack}-${check.kind}`,
            label: stacks.size > 1 ? `${STACK_NAMES[check.stack] ?? check.stack}: ${check.label}` : check.label,
            command: check.command,
            matches: check.matches,
            required: 'always' as const,
        })),
        security: [],
        release: [],
    };
}

export function structureBlock(structure: string): string {
    return structure.trim() ? `## Project structure\nFolders and files in this project (generated folders left out):\n\`\`\`\n${structure.trim()}\n\`\`\`` : '';
}

/** The brief for a "Test my project" run: run the checks, change nothing, explain every failure. */
export function testBrief(checks: ProjectCheck[], structure: string): string {
    const lines = [
        '<task-brief source="FreeAgentCoder">',
        'The user asked to test their project. Report on it; do not change any files unless they ask afterwards.',
        '',
    ];
    if (checks.length) {
        lines.push('## Checks this project has', ...checks.map((c) => `- ${c.label}: \`${c.command}\``));
    } else {
        lines.push(
            '## Checks this project has',
            'None were detected automatically. Find how this project is built and tested (README, Makefile, package or build files) and run that.',
        );
    }
    lines.push(
        '',
        '## How to work',
        '1. Run every check above from the project root, one at a time and not in the background. If a tool is missing, note it and move on.',
        '2. Web app with a dev server: you may start it with background=true, fetch_url the local URL to confirm it responds, then stop it.',
        '3. Machine learning or deep learning project without tests: run a smoke check only (import the model code, or a train or predict script on a tiny subset for one step). Never start a full training run.',
        '4. Do not edit files. You are reporting, not fixing.',
        '',
        '## Report',
        'End with exactly this structure, in plain words a beginner understands:',
        '## Test report',
        'One sentence with the overall result.',
        '### ✓ Passed',
        '- **Check name**: `command`',
        '### ✗ Failed',
        'For each failure:',
        '#### Check name: one-line summary',
        '- **What failed:** the key error line, with `file:line` when there is one',
        '- **Why:** the most likely cause',
        '- **How to fix:** concrete steps or the exact code change',
        '### Not run',
        '- **Check name**: why it could not run and how to make it run',
        'Leave out a section that has nothing in it. Finish by offering to fix the failures.',
        '</task-brief>',
    );
    const block = structureBlock(structure);
    if (block) {
        lines.push('', block);
    }
    lines.push('', '## Request', TEST_PROMPT);
    return lines.join('\n');
}

const DOCS_ONLY = /\.(?:md|mdx|txt|rst|adoc)$/i;

/** Whether any changed file is code or configuration rather than documentation. */
export function codeChanged(paths: Iterable<string>): boolean {
    return [...paths].some((path) => !DOCS_ONLY.test(path));
}

/**
 * Before a task that changed code may end: one of the project's own checks
 * must have passed after the last edit. Undefined when it may finish.
 */
export function verificationReview(checks: ProjectCheck[], runs: SequencedRun[], lastEditSeq: number, finalReply: string): string | undefined {
    const reply = finalReply.trim();
    if (!checks.length || reply.endsWith('?') || EXPLAINS_BLOCKER.test(reply)) {
        return undefined;
    }
    const after = runs.filter((run) => !run.background && run.seq > lastEditSeq && commandVerifies(run.command, checks));
    if (after.some((run) => run.exitCode === 0)) {
        return undefined;
    }
    const fastest = [...checks].sort((a, b) => (a.cost === b.cost ? 0 : a.cost === 'fast' ? -1 : 1))[0];
    const failed = after.at(-1);
    const others = checks.filter((c) => c !== fastest);
    return [
        failed
            ? `Not done yet: \`${failed.command}\` failed after your last change (exit ${failed.exitCode}). Fix what it reports and run it again.`
            : "Not done yet: you changed code but haven't checked it since your last edit.",
        `Before finishing, run a check from the project root, for example \`${fastest.command}\` (${fastest.label.toLowerCase()}).`,
        others.length ? `Other checks this project has: ${others.map((c) => `\`${c.command}\``).join(', ')}.` : '',
        'If no check can run here (for example a required SDK is missing), say so clearly in your final reply instead of retrying.',
    ]
        .filter(Boolean)
        .join('\n');
}
