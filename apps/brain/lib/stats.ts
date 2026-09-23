import 'server-only';
import { store } from './kv';

/**
 * The anonymous counts the extension sends, and what the admin page reads back.
 *
 * Reports are validated field by field and anything unexpected is dropped, so
 * an odd or hostile body can only ever become a few numbers. Nothing here can
 * identify a person or a project: a random install id, provider names, version
 * strings and counts.
 */

const DAY_TTL = 90 * 24 * 60 * 60;
const INSTALL_TTL = 60 * 24 * 60 * 60;
/** One report per install per hour is plenty; the extension sends every twelve. */
export const REPORT_EVERY_SECONDS = 55 * 60;
const MAX_INSTALLS_READ = 2_000;

const ID = /^[a-f0-9-]{8,64}$/i;
const SLUG = /^[a-z0-9]+(?:[-:.][a-z0-9]+)*$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9a-z.-]+)?$/i;

export interface Report {
    install: string;
    extension: string;
    editor: string;
    platform: string;
    days: number;
    keys: { count: number; providers: string[] };
    counters: {
        tasks: number;
        tasksDone: number;
        tasksStopped: number;
        tasksFailed: number;
        failures: Record<string, number>;
        readLocally: number;
        readByModel: number;
    };
}

function count(value: unknown, max = 100_000): number {
    const number = Math.round(Number(value));
    return Number.isFinite(number) && number > 0 ? Math.min(number, max) : 0;
}

function text(value: unknown, pattern: RegExp, max = 40): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim().slice(0, max);
    return pattern.test(trimmed) ? trimmed : undefined;
}

/** Returns the report only if every field is the shape it should be. */
export function parseReport(body: unknown): Report | undefined {
    if (!body || typeof body !== 'object') return undefined;
    const raw = body as Record<string, unknown>;
    const install = text(raw.install, ID, 64);
    if (!install || Number(raw.v) !== 1) return undefined;

    const keys = (raw.keys ?? {}) as Record<string, unknown>;
    const counters = (raw.counters ?? {}) as Record<string, unknown>;
    const failuresRaw = (counters.failures ?? {}) as Record<string, unknown>;
    const failures: Record<string, number> = {};
    for (const [cause, times] of Object.entries(failuresRaw).slice(0, 20)) {
        const slug = text(cause, SLUG, 40);
        if (slug) failures[slug] = count(times, 10_000);
    }

    return {
        install,
        extension: text(raw.extension, VERSION, 20) ?? 'unknown',
        editor: text(raw.editor, VERSION, 20) ?? 'unknown',
        platform: text(raw.platform, /^[a-z0-9]{3,12}$/i, 12) ?? 'unknown',
        days: Math.min(count(raw.days, 400) || 1, 400),
        keys: {
            count: count(keys.count, 100),
            providers: (Array.isArray(keys.providers) ? keys.providers : [])
                .slice(0, 12)
                .map((provider) => text(provider, SLUG, 20))
                .filter((provider): provider is string => !!provider),
        },
        counters: {
            tasks: count(counters.tasks),
            tasksDone: count(counters.tasksDone),
            tasksStopped: count(counters.tasksStopped),
            tasksFailed: count(counters.tasksFailed),
            failures,
            readLocally: count(counters.readLocally),
            readByModel: count(counters.readByModel),
        },
    };
}

function today(offset = 0): string {
    const date = new Date(Date.now() - offset * 86_400_000);
    return date.toISOString().slice(0, 10);
}

export async function recordReport(report: Report): Promise<void> {
    const day = today();
    const { counters } = report;
    await Promise.all([
        store.addCounts(
            `pb:day:${day}`,
            {
                reports: 1,
                tasks: counters.tasks,
                done: counters.tasksDone,
                stopped: counters.tasksStopped,
                failed: counters.tasksFailed,
                readLocally: counters.readLocally,
                readByModel: counters.readByModel,
            },
            DAY_TTL,
        ),
        Object.keys(counters.failures).length ? store.addCounts(`pb:fail:${day}`, counters.failures, DAY_TTL) : Promise.resolve(),
        store.addMember(`pb:active:${day}`, report.install, DAY_TTL),
        store.addMember('pb:installs', report.install, INSTALL_TTL),
        store.put(
            `pb:install:${report.install}`,
            JSON.stringify({
                extension: report.extension,
                editor: report.editor,
                platform: report.platform,
                keys: report.keys.count,
                providers: report.keys.providers,
                days: report.days,
                seen: Date.now(),
            }),
            INSTALL_TTL,
        ),
    ]);
}

export interface Snapshot {
    extension: string;
    editor: string;
    platform: string;
    keys: number;
    providers: string[];
    days: number;
    seen: number;
}

export interface Stats {
    /** Installs that sent a report in the last 1, 7 and 30 days. */
    active: { today: number; week: number; month: number };
    totals: Record<string, number>;
    daily: { day: string; tasks: number; done: number; failed: number; reports: number }[];
    failures: { cause: string; times: number }[];
    keyHistogram: { keys: number; installs: number }[];
    providers: { provider: string; installs: number }[];
    versions: { version: string; installs: number }[];
    platforms: { platform: string; installs: number }[];
    reportingInstalls: number;
    durable: boolean;
}

async function sumDays(prefix: string, days: number): Promise<Record<string, number>> {
    const parts = await Promise.all(Array.from({ length: days }, (_, i) => store.counts(`${prefix}:${today(i)}`)));
    const total: Record<string, number> = {};
    for (const part of parts) {
        for (const [field, value] of Object.entries(part)) total[field] = (total[field] ?? 0) + value;
    }
    return total;
}

async function activeOver(days: number): Promise<number> {
    // A union would be exact; counting the busiest day is close enough and one
    // command per day instead of a set the size of the install base.
    const counts = await Promise.all(Array.from({ length: days }, (_, i) => store.memberCount(`pb:active:${today(i)}`)));
    return Math.max(0, ...counts);
}

export async function readStats(days = 30): Promise<Stats> {
    const [totals, failureTotals, dailyRaw, activeToday, week, month, ids] = await Promise.all([
        sumDays('pb:day', days),
        sumDays('pb:fail', days),
        Promise.all(
            Array.from({ length: 14 }, async (_, i) => {
                const day = today(13 - i);
                const counts = await store.counts(`pb:day:${day}`);
                return { day, tasks: counts.tasks ?? 0, done: counts.done ?? 0, failed: counts.failed ?? 0, reports: counts.reports ?? 0 };
            }),
        ),
        store.memberCount(`pb:active:${today()}`),
        activeOver(7),
        activeOver(30),
        store.members('pb:installs', MAX_INSTALLS_READ),
    ]);

    const raw = await store.getMany(ids.map((id) => `pb:install:${id}`));
    const snapshots = raw
        .map((entry) => {
            try {
                return entry ? (JSON.parse(entry) as Snapshot) : undefined;
            } catch {
                return undefined;
            }
        })
        .filter((entry): entry is Snapshot => !!entry);

    const tally = (values: string[]): Map<string, number> => {
        const map = new Map<string, number>();
        for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
        return map;
    };
    const sorted = (map: Map<string, number>) => [...map].sort((a, b) => b[1] - a[1]);

    const keyCounts = new Map<number, number>();
    for (const snapshot of snapshots) keyCounts.set(snapshot.keys, (keyCounts.get(snapshot.keys) ?? 0) + 1);

    return {
        active: { today: activeToday, week, month },
        totals,
        daily: dailyRaw,
        failures: sorted(new Map(Object.entries(failureTotals)))
            .slice(0, 12)
            .map(([cause, times]) => ({ cause, times })),
        keyHistogram: [...keyCounts].sort((a, b) => a[0] - b[0]).map(([keys, installs]) => ({ keys, installs })),
        providers: sorted(tally(snapshots.flatMap((snapshot) => [...new Set(snapshot.providers)]))).map(([provider, installs]) => ({ provider, installs })),
        versions: sorted(tally(snapshots.map((snapshot) => snapshot.extension)))
            .slice(0, 8)
            .map(([version, installs]) => ({ version, installs })),
        platforms: sorted(tally(snapshots.map((snapshot) => snapshot.platform))).map(([platform, installs]) => ({ platform, installs })),
        reportingInstalls: snapshots.length,
        durable: Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
    };
}
