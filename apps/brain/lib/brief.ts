/**
 * What a person wants from Fyxable, asked before the workbench opens: the
 * goal, the idea, and how it should look. It goes to the agent with every
 * request, so it builds to the brief instead of guessing.
 */

export type Goal = 'website' | 'app' | 'ml' | 'improve' | 'try';

export interface Brief {
    goal: Goal;
    /** The idea, in the person's words. */
    idea: string;
    /** Landing page, portfolio, tracker, chatbot… */
    kind?: string;
    style?: string;
    theme?: string;
    /** A hex colour. */
    accent?: string;
    /** A Google Fonts pairing, like "Space Grotesk + Inter". */
    fonts?: string;
    /** Sections of a site, or screens of an app. */
    sections?: string[];
    /** Asked for a phone app. */
    mobile?: boolean;
}

export const GOAL_ORDER: Goal[] = ['website', 'app', 'ml', 'improve', 'try'];

export const GOALS: Record<Goal, { label: string; blurb: string; get: string }> = {
    website: {
        label: 'Website',
        blurb: 'Pages people visit: a landing page, portfolio, shop front or blog.',
        get: 'A designed site with real sections, built to a short brief you set next. It runs in the preview as it is built.',
    },
    app: {
        label: 'App',
        blurb: 'Something people use: a tracker, dashboard, tool or game.',
        get: 'A working web app with screens, state and data saved in the browser. It works on phones and exports to GitHub.',
    },
    ml: {
        label: 'AI or ML',
        blurb: 'A chatbot, a classifier, something that calls a model.',
        get: 'An AI app that calls a model with your free key, built and run here. Training a model needs Python on your machine: that is the VS Code extension.',
    },
    improve: {
        label: 'Improve an idea',
        blurb: 'You have something already; make it better.',
        get: 'Import it from GitHub or describe it. The agent says what it would change, then builds it.',
    },
    try: {
        label: 'Just try',
        blurb: 'A quick experiment, no plan yet.',
        get: 'The fastest path: your words, a blank project, running in a minute.',
    },
};

const MOBILE = /\b(mobile|android|ios|iphone|phone app|play store|app store|native app)\b/i;
const IMPROVE = /\b(improve|better|redesign|rework|review|feedback|critique|polish|refactor|modernise|modernize|my (current|existing|old))\b/i;
const ML = /\b(machine learning|ml model|train(ing)? (a|my|the) model|dataset|classifier|classify|predict(ion|or)?|neural|llm|chat ?bot|rag|embeddings?|fine[- ]?tun(e|ing)|ai (app|assistant|agent|tool|chat|helper)|summari[sz]er|gpt|gemini|openai)\b/i;
const WEBSITE = /\b(website|web ?site|site|landing|portfolio|blog|home ?page|web ?page|shop|store|storefront|brochure|agency|restaurant|cafe|bakery|salon|clinic|wedding|event page|resume|cv)\b/i;
const APP = /\b(app|tracker|dashboard|tool|saas|to-?do|game|calculator|manager|planner|kanban|notes?|crm|inventory|booking|quiz|timer|editor|player|budget|habit|workout|recipe)\b/i;

/** The path that fits what was typed, and why, in one line. */
export function suggestGoal(text: string): { goal: Goal; why: string; mobile: boolean } {
    const mobile = MOBILE.test(text);
    if (!text.trim()) return { goal: 'try', why: '', mobile };
    if (IMPROVE.test(text)) return { goal: 'improve', why: 'You have something to make better, so the agent reviews before it builds.', mobile };
    if (ML.test(text)) return { goal: 'ml', why: 'It calls a model, so it needs a key and a chat or upload screen.', mobile };
    if (WEBSITE.test(text)) return { goal: 'website', why: 'It is pages people visit, so design and sections matter most.', mobile };
    if (APP.test(text) || mobile) return { goal: 'app', why: 'It is something people use, so screens and saved state matter most.', mobile };
    return { goal: 'try', why: 'Not clearly a site or an app yet; the quickest way to find out is to build it.', mobile };
}

/** The starter that fits: an Express server for an API, Vite and React for everything else. */
export function starterFor(brief: Brief): string {
    return /\b(api|server|backend|endpoint|webhook)\b/i.test(brief.idea) && brief.goal !== 'website' ? 'node' : 'react';
}

/** The first message to the agent, from the brief. */
export function firstRequest(b: Brief): string | undefined {
    const idea = b.idea.trim();
    if (!idea) return undefined;
    switch (b.goal) {
        case 'website':
            return `Build the website: ${idea}`;
        case 'app':
            return `Build the app: ${idea}`;
        case 'ml':
            return `Build this AI app: ${idea}`;
        case 'improve':
            return `Here is the idea: ${idea}\nSay in a few lines what you would improve, then build the first version.`;
        default:
            return idea;
    }
}

/** The brief as lines for the agent's instructions. */
export function briefText(b: Brief): string {
    const lines = [`Goal: ${GOALS[b.goal].label}${b.kind ? ` (${b.kind})` : ''}`];
    if (b.mobile) lines.push('Wanted as a phone app: build a responsive web app that works installed from the browser (a manifest and a viewport that fits), and say so once.');
    if (b.idea) lines.push(`Idea: ${b.idea}`);
    const look = [b.style && `${b.style} style`, b.theme && `${b.theme} theme`, b.accent && `accent colour ${b.accent}`].filter(Boolean);
    if (look.length) lines.push(`Look: ${look.join(', ')}`);
    if (b.fonts) lines.push(`Fonts: ${b.fonts}, loaded from Google Fonts`);
    if (b.sections?.length) lines.push(`${b.goal === 'app' || b.goal === 'ml' ? 'Screens' : 'Sections'}: ${b.sections.join(', ')}`);
    if (b.goal === 'ml') lines.push('The app calls the Gemini API with fetch, using a key the person pastes into a settings field in the app (kept in localStorage). Never hard-code a key.');
    return lines.join('\n');
}

/** A brief sent by the browser, kept to known fields and sane lengths. */
export function readBrief(raw: unknown): Brief | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const r = raw as Record<string, unknown>;
    const text = (key: string, max = 200) => (typeof r[key] === 'string' ? (r[key] as string).trim().slice(0, max) || undefined : undefined);
    const goal = text('goal') as Goal | undefined;
    if (!goal || !GOAL_ORDER.includes(goal)) return undefined;
    const sections = Array.isArray(r.sections) ? r.sections.filter((s): s is string => typeof s === 'string').map((s) => s.slice(0, 40)).slice(0, 12) : undefined;
    return {
        goal,
        idea: text('idea', 1_000) ?? '',
        kind: text('kind', 60),
        style: text('style', 40),
        theme: text('theme', 20),
        accent: /^#[0-9a-f]{3,8}$/i.test(String(r.accent ?? '')) ? (r.accent as string) : undefined,
        fonts: text('fonts', 80),
        sections: sections?.length ? sections : undefined,
        mobile: r.mobile === true,
    };
}
