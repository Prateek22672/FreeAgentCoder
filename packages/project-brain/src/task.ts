/**
 * The Project Brain → VS Code handoff: a plan built from an impact analysis,
 * the brief the agent receives, and a versioned payload carried in a
 * vscode:// link.
 *
 * The payload is untrusted when it arrives — anyone can craft a vscode:// link —
 * so decodeTask validates every field, and the extension only ever places the
 * brief in the chat input for the user to read and send. Nothing runs by itself.
 */
import type { ImpactResult } from './impact';
import type { FileRole } from './types';

export const TASK_VERSION = 1;
export const EXTENSION_ID = 'PrateekKoratala.freeagentcoder';

/** Caps keep the link within what browsers and the OS pass to VS Code. */
export const TASK_LIMITS = { title: 200, brief: 9_000, files: 40, path: 300, repo: 140 };

export interface PlanStep {
    title: string;
    detail: string;
    files: string[];
    /** Files left out of `files` to keep the brief short. */
    more: number;
}

export interface ProjectTask {
    v: 1;
    kind: 'project-task';
    /** owner/repo */
    repo: string;
    ref?: string;
    title: string;
    /** The Markdown the agent receives, exactly as the user will see it. */
    brief: string;
    files: string[];
}

const STEP_FOR: Partial<Record<FileRole, { title: string; detail: string }>> = {
    model: { title: 'Update the data models and schemas', detail: 'Change the shapes first, so everything that uses them fails loudly at the type check.' },
    service: { title: 'Update services and data access', detail: 'Move the logic over to the new models or library.' },
    api: { title: 'Update the API routes', detail: 'Keep request and response shapes compatible unless the change requires otherwise.' },
    component: { title: 'Update the UI components', detail: 'Follow the data changes through to what the user sees.' },
    other: { title: 'Update the remaining code', detail: 'Helpers, entry points and anything else that references the change.' },
    config: { title: 'Update configuration', detail: 'Environment, build and tooling settings.' },
    test: { title: 'Update and extend the tests', detail: 'Fix tests that encode the old behaviour and add coverage for the new one.' },
    doc: { title: 'Update the documentation', detail: 'READMEs and docs that describe the old behaviour.' },
};
const STEP_ORDER: FileRole[] = ['model', 'service', 'api', 'component', 'other', 'config', 'test', 'doc'];
const FILES_PER_STEP = 8;

/** A plan in the order a careful engineer would make the change. Built from the analysis alone: no AI. */
export function buildPlan(impact: ImpactResult): PlanStep[] {
    const direct = new Set(impact.direct);
    const pick = (files: string[]) => {
        // Files that mention the change are the likeliest to need editing.
        const sorted = [...files].sort((a, b) => Number(direct.has(b)) - Number(direct.has(a)) || a.localeCompare(b));
        return { files: sorted.slice(0, FILES_PER_STEP), more: Math.max(0, sorted.length - FILES_PER_STEP) };
    };

    const steps: PlanStep[] = [
        {
            title: 'Confirm the scope',
            detail: 'Read the files that mention the change and check each really needs one. The lists below come from a static analysis and are a starting point, not a guarantee.',
            ...pick(impact.direct.slice(0, 12)),
        },
    ];
    if (impact.externalPackages.length) {
        steps.push({
            title: 'Handle the dependencies involved',
            detail: impact.externalPackages.map((p) => `${p.name} (${p.files ? `imported by ${p.files} files` : 'a tool, not imported'})`).join(', '),
            files: [],
            more: 0,
        });
    }
    for (const role of STEP_ORDER) {
        const group = impact.groups.find((g) => g.role === role);
        const step = STEP_FOR[role];
        if (group && step) steps.push({ ...step, ...pick(group.files) });
    }
    steps.push({
        title: 'Verify',
        detail: "Run the project's own type check, tests and build. Fix every failure before calling it done.",
        files: [],
        more: 0,
    });
    return steps;
}

export interface BriefInput {
    repo: string;
    ref?: string;
    title: string;
    impact: ImpactResult;
    plan: PlanStep[];
    stack?: string;
}

/** The brief the agent works from. Plain Markdown, capped to fit a link. */
export function buildBrief(input: BriefInput): string {
    const { impact } = input;
    const lines = [
        `# ${input.title}`,
        '',
        `Planned in Project Brain for \`${input.repo}\`${input.ref ? ` (branch ${input.ref})` : ''}.${input.stack ? ` Stack: ${input.stack}.` : ''}`,
        '',
        '## Impact (static analysis — verify before relying on it)',
        `- About ${impact.total} files may be affected, risk ${impact.risk}: ${impact.riskReason}`,
        `- By kind: ${impact.groups.map((g) => `${g.files.length} ${g.label.toLowerCase()}`).join(', ')}`,
        ...(impact.externalPackages.length ? [`- Packages: ${impact.externalPackages.map((p) => p.name).join(', ')}`] : []),
        '',
        '## Plan',
    ];
    input.plan.forEach((step, i) => {
        lines.push(`${i + 1}. **${step.title}** — ${step.detail}`);
        if (step.files.length) lines.push(`   Files: ${step.files.map((f) => `\`${f}\``).join(', ')}${step.more ? ` and ${step.more} more` : ''}`);
    });
    lines.push(
        '',
        '## Rules',
        '- Read every file before changing it; confirm it is part of this change.',
        '- Keep changes minimal and in the existing style. Do not refactor unrelated code.',
        '- Work on a new git branch. Do not push, force-push or change git remotes; the user reviews and pushes.',
        "- Finish only when the project's own checks pass.",
    );

    let brief = lines.join('\n');
    if (brief.length > TASK_LIMITS.brief) brief = `${brief.slice(0, TASK_LIMITS.brief - 40).trimEnd()}\n\n… (plan shortened to fit)`;
    return brief;
}

export function createTask(input: BriefInput): ProjectTask {
    const files = [...new Set(input.plan.flatMap((s) => s.files))].slice(0, TASK_LIMITS.files);
    return {
        v: TASK_VERSION,
        kind: 'project-task',
        repo: input.repo,
        ...(input.ref ? { ref: input.ref } : {}),
        title: input.title.slice(0, TASK_LIMITS.title),
        brief: buildBrief(input),
        files,
    };
}

// ---------------------------------------------------------------------------
// Encoding: base64url over UTF-8, with no Node or browser globals, so the same
// code runs on the server, in the page and in the extension.
// ---------------------------------------------------------------------------

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64Url(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
        out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
        if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63]!;
        if (i + 2 < bytes.length) out += ALPHABET[n & 63]!;
    }
    return out;
}

function fromBase64Url(text: string): Uint8Array | undefined {
    if (!/^[A-Za-z0-9_-]*$/.test(text)) return undefined;
    const bytes: number[] = [];
    for (let i = 0; i < text.length; i += 4) {
        const chunk = text.slice(i, i + 4);
        const values = [...chunk].map((c) => ALPHABET.indexOf(c));
        const n = ((values[0] ?? 0) << 18) | ((values[1] ?? 0) << 12) | ((values[2] ?? 0) << 6) | (values[3] ?? 0);
        bytes.push((n >> 16) & 255);
        if (chunk.length > 2) bytes.push((n >> 8) & 255);
        if (chunk.length > 3) bytes.push(n & 255);
    }
    return new Uint8Array(bytes);
}

export function encodeTask(task: ProjectTask): string {
    return toBase64Url(new TextEncoder().encode(JSON.stringify(task)));
}

export function taskUrl(task: ProjectTask, extensionId = EXTENSION_ID): string {
    return `vscode://${extensionId}/task?p=${encodeTask(task)}`;
}

/** Control characters other than tab and newline have no place in a brief. */
const clean = (text: string) => text.replace(/[\u0000-\u0008\u000B-\u001F\u007F‪-‮⁦-⁩]/g, '');

/** A repository-relative path: no leading slash, no "..", no drive letters or URLs. */
const SAFE_PATH = /^(?![/\\])(?!.*(?:^|\/)\.\.(?:\/|$))(?![A-Za-z]:)(?!.*:\/\/)[^\u0000-\u001F]{1,300}$/;

/** Validate a payload from a link. Returns the task, or why it was refused. */
export function decodeTask(encoded: string): ProjectTask | { error: string } {
    if (encoded.length > 40_000) return { error: 'The task link is too long.' };
    const bytes = fromBase64Url(encoded);
    if (!bytes) return { error: 'The task link is malformed.' };
    let data: unknown;
    try {
        data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
        return { error: 'The task link is malformed.' };
    }
    const t = data as Partial<ProjectTask>;
    if (!t || typeof t !== 'object') return { error: 'The task link is malformed.' };
    if (t.v !== TASK_VERSION) return { error: `This task was made by a newer Project Brain (version ${String(t.v)}). Update the extension.` };
    if (t.kind !== 'project-task') return { error: 'Not a Project Brain task.' };
    if (typeof t.repo !== 'string' || !/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(t.repo)) return { error: 'The task names an invalid repository.' };
    if (t.ref !== undefined && (typeof t.ref !== 'string' || !/^[\w./-]{1,200}$/.test(t.ref))) return { error: 'The task names an invalid branch.' };
    if (typeof t.title !== 'string' || !t.title.trim() || t.title.length > TASK_LIMITS.title) return { error: 'The task has no valid title.' };
    if (typeof t.brief !== 'string' || !t.brief.trim() || t.brief.length > TASK_LIMITS.brief) return { error: 'The task has no valid brief.' };
    if (!Array.isArray(t.files) || t.files.length > TASK_LIMITS.files || !t.files.every((f) => typeof f === 'string' && SAFE_PATH.test(f))) {
        return { error: 'The task lists invalid file paths.' };
    }
    return {
        v: TASK_VERSION,
        kind: 'project-task',
        repo: t.repo,
        ...(t.ref ? { ref: t.ref } : {}),
        title: clean(t.title).trim(),
        brief: clean(t.brief).trim(),
        files: t.files,
    };
}
