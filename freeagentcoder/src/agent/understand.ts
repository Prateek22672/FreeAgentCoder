/**
 * Understanding the request before acting on it.
 *
 * Misunderstanding is worse than a useless task: the agent spends minutes and
 * hundreds of thousands of tokens doing the wrong thing, and the user loses
 * trust. So before any work, a fast open model (gpt-oss or Qwen on Groq, or
 * Nemotron on NVIDIA) reads the message together with the last few exchanges
 * and says, as JSON: what the user wants now in plain words, what kind of task
 * it is, whether they are unhappy with the previous answer, what they expect at
 * the end, and what would be a misunderstanding. The agent then works from
 * that, the user sees it, and when the model is unsure it asks one question
 * instead of guessing.
 */

export const TASK_KINDS = [
    'run', // start or preview a project and give the link
    'setup', // install or configure a tool, SDK or dependency
    'build', // make something new
    'change', // add to or modify existing code
    'fix', // something is broken
    'design', // how something looks
    'refactor',
    'data', // datasets, training, analysis
    'documents', // a deck, Word document, PDF or spreadsheet
    'explain', // understand code, change nothing
    'question', // a general question, answered from knowledge
    'chore', // git, zip, move files and the like
    'correction', // the user says the previous work is wrong and how
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export interface Understanding {
    /** The request as one clear instruction, with "it", "this" and "here" resolved from the conversation. */
    request: string;
    kind: TaskKind;
    /** Unrelated to the work so far. */
    newTopic: boolean;
    /** The user is unhappy with the previous answer or work. */
    complaint: boolean;
    /** What went wrong before, in the user's terms, when they complain. */
    previousProblem: string;
    /** What the user expects to have at the end. */
    deliverable: string;
    /** Things that would be a misunderstanding of this request. */
    mustNot: string[];
    /** Paths, URLs, names or values the user supplied. */
    inputs: string[];
    /** One question, only when it is impossible to proceed without the answer. */
    question: string;
    confidence: number;
}

export interface Exchange {
    user: string;
    agent: string;
}

export const UNDERSTAND_SYSTEM = [
    'You are the request interpreter for FreeAgentCoder, an AI coding agent inside VS Code that can read and edit files, run commands (including long installs and dev servers), and open web pages.',
    'Read the conversation and the latest message, and work out exactly what the user wants NOW. Do not do the task. Answer with one JSON object and nothing else.',
    'Rules:',
    '- Resolve "it", "this", "here", "that", "now" from the conversation. A short or angry message usually continues the previous goal: "you run it", "its your job now", "what the fuck I am asking you to run it" all mean "do the previous goal yourself, do not tell me to".',
    '- If the user gives a path to a downloaded file (a zip or installer) after being asked to install something, they want the agent to install it from that file and continue the original goal.',
    '- "kind": run = start or preview a project and give a link; setup = install or configure a tool or SDK; build = make something new; change = modify existing code; fix = something is broken; design = how an app or site looks (layout, colours, style); documents = a presentation or deck (.pptx), Word, PDF or spreadsheet, whatever its topic, never design; explain = understand code without changing it; question = general knowledge; chore = git, zip, files; correction = the user points out what is wrong in the previous work and wants it fixed.',
    '- A presentation, deck or slides means a .pptx file unless the user asks for web slides.',
    '- "new_topic": true when the latest message asks for something unrelated to the goal of the previous messages (for example a presentation after trying to run an app); false when it continues, repeats, corrects or complains about that goal.',
    '- "complaint": true when the user is unhappy with the previous reply or work (repeats the request, swears, says it is wrong or not what they asked).',
    '- "must_not": list what would misread the request, especially what the previous reply did wrong (for example "tell the user to install it themselves", "add features to the app").',
    '- "question": only if the request cannot be acted on at all without it; otherwise "". Prefer acting with a sensible default.',
    '- "inputs": copy every path, URL, file name or value from the latest message exactly as written.',
    '- Write "request" and "deliverable" in plain English, one sentence each. Describe the kind of result ("a link to the running app"); never write an address, port, file name or value the user did not give.',
    'JSON keys: request, kind, new_topic, complaint, previous_problem, deliverable, must_not, inputs, question, confidence (0 to 1).',
].join('\n');

const MAX_TURN_CHARS = 700;
const MAX_ATTACHMENT_CHARS = 1_200;

function clip(text: string, max: number): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export function understandPrompt(input: { message: string; history: Exchange[]; attachments?: { name: string; preview?: string }[]; folder?: string }): string {
    const parts: string[] = [];
    if (input.folder) {
        parts.push(`Open folder: ${input.folder}`);
    }
    const recent = input.history.slice(-4);
    if (recent.length) {
        parts.push(
            'Conversation so far (oldest first):',
            ...recent.map((e, i) => `[${i + 1}] User: ${clip(e.user, MAX_TURN_CHARS)}\n[${i + 1}] Agent: ${clip(e.agent || '(no reply text)', MAX_TURN_CHARS)}`),
        );
    } else {
        parts.push('This is the first message of the conversation.');
    }
    for (const a of input.attachments ?? []) {
        parts.push(`Attached: ${a.name}${a.preview ? `\n${clip(a.preview, MAX_ATTACHMENT_CHARS)}` : ''}`);
    }
    parts.push(`Latest message:\n${input.message.trim()}`);
    return parts.join('\n\n');
}

const asText = (value: unknown, max = 400) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const asList = (value: unknown) => (Array.isArray(value) ? value.map((v) => asText(v, 300)).filter(Boolean).slice(0, 8) : []);

/** The model's JSON, read leniently (code fences, text around it); undefined when it is not usable. */
export function parseUnderstanding(reply: string): Understanding | undefined {
    const start = reply.indexOf('{');
    const end = reply.lastIndexOf('}');
    if (start < 0 || end <= start) {
        return undefined;
    }
    let raw: Record<string, unknown>;
    try {
        raw = JSON.parse(reply.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
        return undefined;
    }
    const request = asText(raw.request);
    const kind = TASK_KINDS.find((k) => k === asText(raw.kind).toLowerCase());
    if (!request || !kind) {
        return undefined;
    }
    const confidence = Number(raw.confidence);
    return {
        request,
        kind,
        newTopic: raw.new_topic === true,
        complaint: raw.complaint === true,
        previousProblem: asText(raw.previous_problem),
        deliverable: asText(raw.deliverable),
        mustNot: asList(raw.must_not),
        inputs: asList(raw.inputs),
        question: asText(raw.question),
        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.6,
    };
}

/** Windows and Unix paths and URLs written in a message. */
const PATHS = /(?:[A-Za-z]:\\[^\s"'<>|*?]+|(?:^|\s)(?:~|\.{1,2})?\/[\w.\-/]+\.\w+|https?:\/\/\S+)/g;

/** The inputs the model listed plus every path or URL in the message itself, which are never left out. */
export function withInputsFrom(message: string, u: Understanding): Understanding {
    const found = (message.match(PATHS) ?? []).map((p) => p.trim().replace(/[.,;)]+$/, ''));
    const inputs = [...u.inputs];
    for (const path of found) {
        if (!inputs.some((i) => i.includes(path))) {inputs.push(path);}
    }
    return { ...u, inputs: inputs.slice(0, 10) };
}

/** The thing made is a document: a deck, a Word file, a PDF or a spreadsheet. */
const DOCUMENT_DELIVERABLE = /\b(?:pptx|power\s*point|presentation|slide\s*deck|deck|slides|docx|word\s+(?:document|file)|pdf|xlsx|spreadsheet)\b/i;
const WEB_SLIDES = /\b(?:web|html|reveal(?:\.js)?|browser)\s+(?:slides?|presentation|deck)\b/i;

/**
 * The understanding with the user's inputs added and the rules that do not
 * depend on the model applied: when what they will get is a deck, a document
 * or a PDF, the task is documents, whatever the model called it (it once said
 * "design" for a presentation, which would have built a web page).
 */
export function settleUnderstanding(message: string, u: Understanding): Understanding {
    // "You will get: the app at http://127.0.0.1:8084" was shown to a user for a link nothing served.
    const invented = (text: string) => text.replace(/\b(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):\d+\S*/gi, (m) => (message.includes(m) ? m : 'a local address'));
    const settled = withInputsFrom(message, { ...u, request: invented(u.request), deliverable: invented(u.deliverable) });
    const made = `${u.deliverable} ${u.request}`;
    if ((settled.kind === 'design' || settled.kind === 'build') && DOCUMENT_DELIVERABLE.test(made) && !WEB_SLIDES.test(`${message} ${made}`)) {
        return { ...settled, kind: 'documents' };
    }
    return settled;
}

/** Whether to ask instead of act: only an explicit question with low confidence. */
export function shouldAsk(u: Understanding): boolean {
    return !!u.question && u.confidence < 0.45;
}

/** The block the agent works from, ahead of the user's own words. */
export function understandingBlock(u: Understanding): string {
    const lines = [
        '<understood source="FreeAgentCoder">',
        'Before this task, the editor worked out from the conversation what the user wants. Work from this; the user\'s own words follow and win if they disagree.',
        `What the user wants now: ${u.request}`,
    ];
    if (u.deliverable) {lines.push(`They expect at the end: ${u.deliverable}`);}
    if (u.inputs.length) {lines.push(`What they gave you: ${u.inputs.join('; ')}`);}
    if (u.complaint) {lines.push(`They are unhappy with the previous reply${u.previousProblem ? `: ${u.previousProblem}` : ''}. Do not repeat it; do the work yourself instead of telling them to.`);}
    if (u.mustNot.length) {lines.push(`A misunderstanding would be: ${u.mustNot.join('; ')}.`);}
    lines.push('</understood>');
    return lines.join('\n');
}

/** Kinds whose work is planned and checked (the deep tier); the rest are answered quickly. */
export function tierFor(kind: TaskKind): 'fast' | 'deep' {
    return kind === 'question' || kind === 'explain' || kind === 'chore' ? 'fast' : 'deep';
}

/** The specialist method for a kind, when there is one. */
export function specialistFor(kind: TaskKind): string | undefined {
    switch (kind) {
        case 'fix':
        case 'design':
        case 'refactor':
        case 'data':
        case 'build':
        case 'explain':
            return kind;
        default:
            return undefined;
    }
}

/** Proven structures and design references help only when something new is being made. */
export function wantsReferences(kind: TaskKind): boolean {
    return kind === 'build' || kind === 'design' || kind === 'documents';
}

/** A local search for "likely relevant files" helps code work, not running, installing or answering. */
export function wantsFileSearch(kind: TaskKind): boolean {
    return kind === 'change' || kind === 'fix' || kind === 'refactor' || kind === 'design' || kind === 'correction' || kind === 'explain';
}

/** The conversation as plain exchanges, from what the chat panel shows: the user's own words and the agent's replies. */
export function exchangesFrom(messages: { type: string; turnId?: string; prompt?: string; content?: string; delta?: string }[]): Exchange[] {
    const byTurn = new Map<string, Exchange>();
    for (const m of messages) {
        if (!m.turnId) {continue;}
        if (m.type === 'turnStart' && typeof m.prompt === 'string') {
            byTurn.set(m.turnId, { user: m.prompt, agent: '' });
        } else if (m.type === 'assistant' && typeof m.content === 'string') {
            const e = byTurn.get(m.turnId);
            if (e && m.content.trim()) {e.agent = m.content.trim();}
        }
    }
    return [...byTurn.values()];
}
