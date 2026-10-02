import 'server-only';
import { createHash } from 'node:crypto';
import { settingsNeedStore, store } from './kv';

/**
 * The extension's free trial: someone who installs FreeAgentCoder and has no
 * key yet can still run real tasks, on the site's key pool, within a daily
 * allowance. After that they add their own free key, which is faster and
 * private, and the trial steps aside by itself.
 *
 * Three limits, all set from the admin page:
 *  - per install, a day: enough for one or two real tasks;
 *  - per network address, a day: a few installs' worth, so a fresh install id
 *    does not reset it, while a shared office or campus still gets through;
 *  - for everyone, a day: so the pool's free quota is never drained, and the
 *    site's own free trial keeps working.
 *
 * Counts are kept by day (UTC). An install is known only by a random id the
 * extension makes for this purpose, hashed before it is stored.
 */

export interface ExtTrialSettings {
    enabled: boolean;
    /** Model requests per install per day. One agent task is usually 8 to 15. */
    requestsPerInstall: number;
    /** Tokens per install per day, prompts and replies together. */
    tokensPerInstall: number;
    /** Model requests per network address per day. */
    requestsPerAddress: number;
    /** Model requests for everyone together per day. */
    dailyCap: number;
}

export const DEFAULT_EXT_TRIAL: ExtTrialSettings = {
    enabled: true,
    // 35% below the first limits (40, 400K, 120, 1,500), to spend the pool's keys more slowly.
    requestsPerInstall: 26,
    tokensPerInstall: 260_000,
    requestsPerAddress: 78,
    dailyCap: 975,
};

const SETTINGS = 'pb:exttrial:settings';
const TEN_YEARS = 10 * 365 * 24 * 60 * 60;
const DAY_TTL = 40 * 24 * 60 * 60;
const ONE_DAY = 2 * 24 * 60 * 60;

export const today = (offset = 0) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
const salt = () => process.env.BRAIN_TRIAL_SALT ?? 'project-brain';
export const hashOf = (value: string) => createHash('sha256').update(`${salt()}:${value}`).digest('hex').slice(0, 32);

export async function readExtTrialSettings(): Promise<ExtTrialSettings> {
    const [raw] = await store.getMany([SETTINGS]);
    if (!raw) return DEFAULT_EXT_TRIAL;
    try {
        return { ...DEFAULT_EXT_TRIAL, ...(JSON.parse(raw) as Partial<ExtTrialSettings>) };
    } catch {
        return DEFAULT_EXT_TRIAL;
    }
}

export async function writeExtTrialSettings(input: ExtTrialSettings): Promise<string | undefined> {
    if (settingsNeedStore) return 'Not saved: this deployment has no storage connected.';
    const whole = (n: number, max: number) => Number.isFinite(n) && n >= 0 && n <= max;
    if (!whole(input.requestsPerInstall, 10_000) || !whole(input.requestsPerAddress, 100_000) || !whole(input.dailyCap, 1_000_000) || !whole(input.tokensPerInstall, 100_000_000)) {
        return 'Each limit must be a whole number, zero or more.';
    }
    const clean: ExtTrialSettings = {
        enabled: input.enabled,
        requestsPerInstall: Math.round(input.requestsPerInstall),
        tokensPerInstall: Math.round(input.tokensPerInstall),
        requestsPerAddress: Math.round(input.requestsPerAddress),
        dailyCap: Math.round(input.dailyCap),
    };
    await store.put(SETTINGS, JSON.stringify(clean), TEN_YEARS);
    return undefined;
}

/** The trial id the extension sends: "fact_" and a UUID. */
export function installFrom(request: Request): string | undefined {
    const match = /^Bearer\s+fact_([0-9a-f-]{36})$/i.exec(request.headers.get('authorization') ?? '');
    return match?.[1]?.toLowerCase();
}

export function addressFrom(request: Request): string {
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    return hashOf(`ip:${forwarded || request.headers.get('x-real-ip') || 'unknown'}`);
}

export interface Allowance {
    ok: boolean;
    /** Why it was refused, in words the extension shows. */
    reason?: string;
    code?: 'trial_off' | 'trial_daily_limit' | 'trial_closed';
    requestsLeft: number;
    tokensLeft: number;
    limit: number;
}

const resetNote = 'It resets at 00:00 UTC. Add your own free Gemini or Groq key in Settings → API Keys to keep going now.';

/** Whether this install may make one more request now, without counting it. */
export async function allowance(install: string, address: string, settings: ExtTrialSettings): Promise<Allowance> {
    const day = today();
    const [mine, net, all] = await Promise.all([
        store.counts(`pb:exttrial:i:${day}:${hashOf(install)}`),
        store.counts(`pb:exttrial:a:${day}:${address}`),
        store.counts(`pb:exttrial:day:${day}`),
    ]);
    const requestsLeft = Math.max(0, settings.requestsPerInstall - (mine.r ?? 0));
    const tokensLeft = Math.max(0, settings.tokensPerInstall - (mine.t ?? 0));
    const base = { requestsLeft, tokensLeft, limit: settings.requestsPerInstall };
    if (!settings.enabled) return { ...base, ok: false, code: 'trial_off', reason: 'The FreeAgentCoder free trial is switched off. Add your own free key in Settings → API Keys.' };
    if (requestsLeft <= 0 || tokensLeft <= 0) {
        return { ...base, ok: false, code: 'trial_daily_limit', reason: `FreeAgentCoder free trial: today's allowance per day is used up. ${resetNote}` };
    }
    if ((net.r ?? 0) >= settings.requestsPerAddress) {
        return { ...base, ok: false, code: 'trial_daily_limit', reason: `FreeAgentCoder free trial: this network has used today's allowance per day. ${resetNote}` };
    }
    if ((all.requests ?? 0) >= settings.dailyCap) {
        return { ...base, ok: false, code: 'trial_closed', reason: `FreeAgentCoder free trial: the shared allowance per day is used up for everyone today. ${resetNote}` };
    }
    return { ...base, ok: true };
}

/** Counts one answered request against the install, the address and the day. */
export async function charge(install: string, address: string, tokens: number, provider: string): Promise<void> {
    const day = today();
    const who = hashOf(install);
    await Promise.all([
        store.addCounts(`pb:exttrial:i:${day}:${who}`, { r: 1, t: tokens }, ONE_DAY),
        store.addCounts(`pb:exttrial:a:${day}:${address}`, { r: 1 }, ONE_DAY),
        store.addCounts(`pb:exttrial:day:${day}`, { requests: 1, tokens, [`p:${provider}`]: 1 }, DAY_TTL),
        store.addMember(`pb:exttrial:users:${day}`, who, DAY_TTL),
        store.firstIn(`pb:exttrial:seen:${who}`, TEN_YEARS).then((first) => (first ? store.addCounts(`pb:exttrial:day:${day}`, { newInstalls: 1 }, DAY_TTL) : undefined)),
    ]);
}

/** Counts a refusal or a failure, so the admin page can show who is being turned away and why. */
export async function note(kind: 'refused_limit' | 'refused_closed' | 'refused_off' | 'failed', install?: string): Promise<void> {
    const day = today();
    await store.addCounts(`pb:exttrial:day:${day}`, { [kind]: 1 }, DAY_TTL);
    if (install && kind === 'refused_limit') await store.addMember(`pb:exttrial:capped:${day}`, hashOf(install), DAY_TTL);
}

export interface ExtTrialDay {
    day: string;
    installs: number;
    newInstalls: number;
    requests: number;
    tokens: number;
    reachedLimit: number;
    refusedLimit: number;
    refusedClosed: number;
    refusedOff: number;
    failed: number;
    providers: Record<string, number>;
}

/** The last `days` days, newest first, for the admin page. */
export async function extTrialStats(days = 7): Promise<ExtTrialDay[]> {
    const out: ExtTrialDay[] = [];
    for (let i = 0; i < days; i++) {
        const day = today(i);
        const [counts, installs, capped] = await Promise.all([
            store.counts(`pb:exttrial:day:${day}`),
            store.memberCount(`pb:exttrial:users:${day}`),
            store.memberCount(`pb:exttrial:capped:${day}`),
        ]);
        const providers: Record<string, number> = {};
        for (const [field, value] of Object.entries(counts)) if (field.startsWith('p:')) providers[field.slice(2)] = value;
        out.push({
            day,
            installs,
            newInstalls: counts.newInstalls ?? 0,
            requests: counts.requests ?? 0,
            tokens: counts.tokens ?? 0,
            reachedLimit: capped,
            refusedLimit: counts.refused_limit ?? 0,
            refusedClosed: counts.refused_closed ?? 0,
            refusedOff: counts.refused_off ?? 0,
            failed: counts.failed ?? 0,
            providers,
        });
    }
    return out;
}
