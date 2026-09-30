import type { Tier } from '../shared/protocol';

/**
 * Specialists: the kind of work, as opposed to the stack it is done in.
 *
 * Playbooks answer "which toolchain and which checks" — Flutter, a web app, a
 * Python API. Specialists answer "how should this task be approached", which
 * differs far more than people expect: a bug must be reproduced before it is
 * fixed, a refactor must not change behaviour, a redesign must match the
 * design system already there, an ML change must be reproducible. Most agent
 * failures are method failures — fixing a bug nobody reproduced, "cleaning
 * up" code into a different program — not knowledge failures.
 *
 * A specialist is instructions and a finishing checklist, chosen by what the
 * request asks for. It is not a separately trained model; the same model does
 * the work, with the method that suits it. Each can be switched off, extended,
 * or pointed at a preferred model from the admin page (see remoteConfig).
 */

export type SpecialistId = 'fix' | 'build' | 'design' | 'refactor' | 'data' | 'explain';

export interface Specialist {
    id: SpecialistId;
    name: string;
    /** What in a request marks this kind of work. Checked in the order of SPECIALISTS. */
    request: RegExp;
    /** The smallest tier that can do this well. */
    minTier: Tier;
    method: string[];
    /** What must be true before the task may be reported done. */
    finish: string[];
}

const FIX: Specialist = {
    id: 'fix',
    name: 'Debugging',
    request:
        /\b(?:fix|bug|broken|breaks?|crash(?:es|ing)?|error|exception|fails?|failing|failure|not working|doesn'?t work|isn'?t working|stopped working|wrong result|regression|stack ?trace|traceback|undefined is not|null pointer|500|404)\b/i,
    minTier: 'deep',
    method: [
        'Reproduce it first. Find or write the smallest command, test or input that shows the failure, and run it. If you cannot reproduce it, say so and ask for what you need — do not guess at a fix.',
        'Find the cause, not the symptom. Read the code path the failure goes through and state in one sentence why it happens before changing anything.',
        'Make the smallest change that removes the cause. Do not refactor, rename or restyle anything else on the way.',
        'Add a test that failed before the fix and passes after it, where the project has tests.',
        'Run the reproduction again and show it passing.',
    ],
    finish: ['The reproduction was run before and after, and now passes.', 'The cause is stated in one sentence in the report.', 'Nothing unrelated to the bug was changed.'],
};

const DESIGN: Specialist = {
    id: 'design',
    name: 'Interface design',
    request:
        /\b(?:ui|ux|design|redesign|layout|styl(?:e|ing)|css|tailwind|responsive|mobile view|dark mode|light mode|theme|colou?rs?|font|spacing|align(?:ed|ment)?|animation|landing page|hero|navbar|sidebar|modal|button|looks? (?:bad|off|ugly|better))\b/i,
    minTier: 'deep',
    method: [
        'Read the existing design first: the component library, tokens or CSS variables, spacing scale and one or two similar screens. Match them; do not introduce a second style.',
        'Reuse existing components before writing new ones.',
        'Build for small screens as well as large: check the layout at phone width, and that nothing overflows horizontally.',
        'Keep it accessible: real buttons and labels, visible focus, text contrast that passes, images with alt text.',
        'Where the project can run, start it and check the result rather than assuming it looks right.',
    ],
    finish: ['Uses the project’s existing components and tokens.', 'Checked at phone width with no horizontal overflow.', 'Interactive elements are reachable by keyboard and labelled.'],
};

const REFACTOR: Specialist = {
    id: 'refactor',
    name: 'Refactoring',
    request: /\b(?:refactor|clean ?up|restructure|reorgani[sz]e|simplify|split (?:up|into)|extract|rename|dedupe|de-?duplicate|tidy|modernise|modernize|migrate (?:to|from)|upgrade)\b/i,
    minTier: 'deep',
    method: [
        'The rule: behaviour does not change. If a change would alter what the program does, stop and ask.',
        'Run the existing tests before touching anything, and record which pass. If there are none for this code, write a few that pin down current behaviour first.',
        'Move in small steps, running the tests after each one. Never combine a refactor with a feature or a fix.',
        'Update every caller of anything renamed or moved — search the whole project, not just the open file.',
    ],
    finish: ['The same tests pass after as before.', 'No behaviour changed, or every change was agreed with the user.', 'No caller was left pointing at an old name.'],
};

const DATA: Specialist = {
    id: 'data',
    name: 'Data and ML',
    request:
        /\b(?:model|train(?:ing)?|dataset|data ?set|dataframe|pandas|numpy|sklearn|scikit|pytorch|torch|tensorflow|keras|notebook|jupyter|csv|feature engineering|accuracy|precision|recall|loss|epoch|fine-?tun(?:e|ing)|embedding|regression|classif(?:y|ier|ication)|cluster(?:ing)?|predict(?:ion)?)\b/i,
    minTier: 'deep',
    method: [
        'Make it reproducible: fix random seeds, pin versions, and never train or evaluate on data the model has already seen.',
        'Look at the data before modelling it: shape, types, missing values, class balance. Say what you found.',
        'Start with the simplest baseline and report its score, so any improvement means something.',
        'Keep training small enough to run here. Anything needing a GPU or hours of compute: write it, test it on a tiny sample, and say what the full run needs.',
        'Report metrics on a held-out set, with the number, not a description of it.',
    ],
    finish: ['Seeds are fixed and the split is held out.', 'A baseline score and the new score are both reported.', 'It was run end to end, at least on a small sample.'],
};

const BUILD: Specialist = {
    id: 'build',
    name: 'Building',
    request:
        /\b(?:build|create|make|add|implement|develop|write|set ?up|scaffold|generate|integrate|connect|new (?:[a-z]+ )?(?:page|feature|endpoint|screen|app|component|project|form|section)|feature|endpoint|api|auth(?:entication)?|login|sign ?up|payment|checkout|dashboard|crud|database|backend|frontend|full[- ]?stack)\b/i,
    minTier: 'deep',
    method: [
        'Understand the project before adding to it: its structure, the patterns it already uses for similar things, and how it is run and tested.',
        'Plan the change as concrete steps with todo_write, ending with how it will be verified.',
        'Build it end to end — data, logic, interface, wiring — rather than a front with nothing behind it. Never leave a placeholder that looks finished.',
        'Follow the project’s existing conventions for naming, structure and error handling.',
        'Handle the failure cases a real user will hit: empty input, no network, a slow response, a missing permission.',
        'Run it, and the project’s checks, before finishing.',
    ],
    finish: ['It works end to end, with nothing faked.', 'The project’s own checks pass.', 'The report says how to use it and what is left to do.'],
};

const EXPLAIN: Specialist = {
    id: 'explain',
    name: 'Explaining',
    request: /^(?:what|why|how|where|when|which|who|explain|describe|walk me through|tell me|can you explain|help me understand)\b/i,
    minTier: 'fast',
    method: [
        'Answer from the code, not from general knowledge: read the relevant files and cite them as path:line.',
        'Lead with the direct answer in a sentence or two, then the detail.',
        'Change nothing unless the user asks.',
    ],
    finish: ['The answer cites the files it came from.', 'No files were changed.'],
};

/** Checked in this order: the first match wins, so the more specific methods come first. */
export const SPECIALISTS: Specialist[] = [FIX, REFACTOR, DESIGN, DATA, BUILD, EXPLAIN];

export function specialistById(id: string): Specialist | undefined {
    return SPECIALISTS.find((s) => s.id === id);
}

/**
 * Picks the specialist for a request, or none when nothing clearly applies.
 * `enabled` lets the admin switch specialists off without a new release.
 */
export function chooseSpecialist(prompt: string, enabled?: ReadonlySet<string>): Specialist | undefined {
    const text = prompt.trim();
    if (!text) {
        return undefined;
    }
    for (const specialist of SPECIALISTS) {
        if (enabled && !enabled.has(specialist.id)) {
            continue;
        }
        if (specialist.id === 'explain') {
            // A question that also asks for a change is not an explanation.
            if (specialist.request.test(text) && !FIX.request.test(text) && !BUILD_VERB.test(text)) {
                return specialist;
            }
            continue;
        }
        if (specialist.request.test(text)) {
            return specialist;
        }
    }
    return undefined;
}

const BUILD_VERB = /\b(?:fix|add|build|create|make|change|update|implement|write|remove|delete|refactor)\b/i;

/** The section added to the agent's brief. `extra` is the admin's addition, if any. */
export function specialistSection(specialist: Specialist, extra?: string): string {
    const lines = [
        `## Method: ${specialist.name}`,
        'This kind of task has a method that matters more than speed. Follow it.',
        ...specialist.method.map((step, i) => `${i + 1}. ${step}`),
        '',
        '### Before you report it done',
        ...specialist.finish.map((item) => `- ${item}`),
    ];
    if (extra?.trim()) {
        lines.push('', '### Also', extra.trim());
    }
    return lines.join('\n');
}
