/**
 * What an anonymous report contains, built as plain data so it can be shown to
 * the user in full and checked by tests.
 *
 * The rule this file exists to enforce: counts only. No code, no prompts, no
 * file or project names, no keys, no machine identifiers. Provider names are
 * kept because "most people only have a Gemini key" is the whole point of
 * asking; which key, and its value, never leave the machine.
 */

/** Raised when the shape changes, so old reports can be told apart. */
export const REPORT_VERSION = 1;

export interface Counters {
    /** Tasks started, and how they ended. */
    tasks: number;
    tasksDone: number;
    tasksStopped: number;
    tasksFailed: number;
    /** Why tasks failed, by cause: "gemini:daily-limit", "network", "no-keys". */
    failures: Record<string, number>;
    /** Images read on this computer, and images sent to a vision model. */
    readLocally: number;
    readByModel: number;
}

export interface Report {
    v: number;
    /** Random, made on this install. Not the machine id, not an account. */
    install: string;
    extension: string;
    editor: string;
    platform: string;
    /** Days the install has been counting for, so a report can be weighted. */
    days: number;
    keys: {
        count: number;
        /** Provider names only, sorted, each one once. */
        providers: string[];
    };
    counters: Counters;
}

export function emptyCounters(): Counters {
    return { tasks: 0, tasksDone: 0, tasksStopped: 0, tasksFailed: 0, failures: {}, readLocally: 0, readByModel: 0 };
}

const MAX_FAILURE_KINDS = 20;
/** A cause is a short slug; anything else is dropped rather than sent. */
const KIND = /^[a-z0-9]+(?:[-:][a-z0-9]+)*$/;

export function addFailure(counters: Counters, kind: string): void {
    const slug = kind.trim().toLowerCase().slice(0, 40);
    if (!KIND.test(slug) || (Object.keys(counters.failures).length >= MAX_FAILURE_KINDS && !(slug in counters.failures))) {
        return;
    }
    counters.failures[slug] = (counters.failures[slug] ?? 0) + 1;
}

export interface ReportInput {
    install: string;
    extension: string;
    editor: string;
    platform: string;
    since: number;
    now: number;
    providers: string[];
    keyCount: number;
    counters: Counters;
}

export function buildReport(input: ReportInput): Report {
    return {
        v: REPORT_VERSION,
        install: input.install,
        extension: input.extension,
        editor: input.editor,
        platform: input.platform,
        days: Math.max(1, Math.round((input.now - input.since) / 86_400_000)),
        keys: {
            count: Math.max(0, Math.round(input.keyCount)),
            providers: [...new Set(input.providers.map((p) => p.toLowerCase()))].filter((p) => KIND.test(p)).sort(),
        },
        counters: input.counters,
    };
}

/** The report as the user is shown it, before deciding whether to send any. */
export function describeReport(report: Report): string {
    return JSON.stringify(report, null, 2);
}
