import type { LessonScope } from '../shared/protocol';

const CORRECTION =
    /\b(wrong|incorrect|not correct|not (?:what|how) i|not working|doesn'?t work|does not work|didn'?t work|did not work|isn'?t working|still (?:not|broken|failing|wrong|showing|getting|there|the same|happening)|broken|you (?:missed|forgot|broke|removed|changed|ignored|didn'?t)|should (?:be|have|not)|shouldn'?t|instead of|fix (?:this|that|it)|revert|undo that|that'?s not|nothing (?:changed|happened)|same (?:error|issue|problem)|error (?:still|again)|misaligned|overlapp?ing|cut off|not showing|not visible|not displayed|looks (?:wrong|off|bad|broken)|crash(?:es|ed|ing)?)\b/i;
const POINTING = /\b(this|here|see|look|screenshot|image|attached|highlighted|circled|marked)\b/i;

/**
 * Whether a message points out a problem with earlier work, so it is handled
 * as a precise correction rather than as a new task.
 */
export function isCorrection(prompt: string, hasPreviousTurn: boolean, hasAttachments: boolean): boolean {
    if (!hasPreviousTurn) {
        return false;
    }
    if (CORRECTION.test(prompt)) {
        return true;
    }
    return hasAttachments && prompt.trim().split(/\s+/).length <= 40 && POINTING.test(prompt);
}

export function correctionBrief(prompt: string): string {
    return `# Correction requested
The user is pointing out something wrong or missing in earlier work. Their description and any attached evidence are the ground truth, even if you believed the earlier result was correct.

1. Write each point the user raised as its own todo item (todo_write), in their words. If an attachment shows the problem, state exactly what it shows.
2. Find the real cause of each point before editing: read the relevant code and reproduce the problem where you can (the build, test or command that shows it).
3. Make the smallest change that fixes each point. Don't rewrite, restyle or "improve" unrelated code, and don't undo parts that work.
4. Verify each point separately with the check that proves it; mark it completed only then.
5. If a point is ambiguous or you can't reproduce it, say exactly what you checked and ask one precise question instead of guessing.
6. End with "### Corrections": for each point, what was wrong, what you changed (\`path:line\`), and how you verified it.

## The user's correction
${prompt}`;
}

export const LEARN_SYSTEM = `You turn a user's correction of a coding agent into durable lessons the agent will follow in future tasks.
A lesson is one short, general, actionable rule (at most 25 words) that would have prevented the mistake, for example:
- "Use Riverpod for state management in this app, not setState."
- "Run flutter analyze and fix every warning before saying a Flutter task is done."
- "Keep the existing color palette; never change brand colors unless asked."
Only include lessons that reflect a stable preference, project convention or recurring pitfall. Skip one-off facts such as a single typo, a specific bug that is now fixed, or file contents.
Use scope "global" only for how the user likes to work in every project; otherwise "project".
Never include secrets, keys, personal data or file paths outside the project.
Reply with JSON only: {"lessons":[{"text":"...","scope":"project"}]} with at most 2 lessons, or {"lessons":[]} if nothing durable was learned.`;

export function learnPrompt(input: { correction: string; evidence?: string; report: string; existing: string[] }): string {
    return [
        `The user's correction:\n"""${input.correction.slice(0, 3_000)}"""`,
        input.evidence ? `What the user's attachments showed:\n"""${input.evidence.slice(0, 2_000)}"""` : '',
        `The agent's final report after fixing it:\n"""${input.report.slice(-2_500)}"""`,
        input.existing.length ? `Lessons already saved (don't repeat them):\n${input.existing.map((l) => `- ${l}`).join('\n')}` : '',
    ]
        .filter(Boolean)
        .join('\n\n');
}

export function parseLessons(text: string): { text: string; scope: LessonScope }[] {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
        return [];
    }
    try {
        const json = JSON.parse(match[0]) as { lessons?: unknown };
        if (!Array.isArray(json.lessons)) {
            return [];
        }
        return json.lessons
            .flatMap((item) => {
                const entry = item as { text?: unknown; scope?: unknown };
                const lesson = typeof entry.text === 'string' ? entry.text.replace(/\s+/g, ' ').trim() : '';
                return lesson.length >= 8 && lesson.length <= 240 ? [{ text: lesson, scope: (entry.scope === 'global' ? 'global' : 'project') as LessonScope }] : [];
            })
            .slice(0, 2);
    } catch {
        return [];
    }
}

const REMEMBER = /^(?:remember|memorize|note)(?:\s+that)?\s*[:,-]?\s+(.{8,})$/is;

/** "remember that we use pnpm" saves a lesson directly, without running a task. */
export function rememberCommand(prompt: string): { text: string; scope: LessonScope } | undefined {
    const match = prompt.trim().match(REMEMBER);
    if (!match) {
        return undefined;
    }
    const text = match[1].trim();
    const global = /\b(in )?(all|every) (my )?projects?\b|\beverywhere\b|\balways\b.*\bprojects?\b/i.test(text);
    return { text: text.replace(/\s*\b(?:in )?(?:all|every) (?:my )?projects?\b\.?$/i, '').trim(), scope: global ? 'global' : 'project' };
}
