import * as vscode from 'vscode';
import { SITE_URL } from '../shared/site';
import { KEY_PROVIDERS } from './catalog';
import { SPECIALISTS, type SpecialistId } from './specialists';

/**
 * How the admin page tunes specialists without a new release: switch one off,
 * add instructions to it, or point it at a preferred model.
 *
 * Fetched at most once a day, as a plain GET that sends nothing about the user
 * or their project, and cached so the extension never waits on it. It can be
 * turned off with `freeagentcoder.specialistUpdates`. Everything that arrives
 * is validated and capped before use — this text reaches the agent's
 * instructions, so the rules here are deliberately strict.
 */

export interface SpecialistOverride {
    enabled: boolean;
    /** Added to the specialist's method as an "Also" section. */
    extra: string;
    /** "provider:model", tried first when the user is on Auto and has a key for it. */
    model: string;
}

export type SpecialistConfig = Partial<Record<SpecialistId, SpecialistOverride>>;

const STATE = 'freeagentcoder.specialistConfig';
const REFERENCES = 'freeagentcoder.references';
const FETCHED = 'freeagentcoder.specialistConfigFetched';
const EVERY_MS = 24 * 60 * 60 * 1000;
/** A known provider, then a model id with no URL-like parts. */
function validModel(value: string): boolean {
    const match = /^([a-z]+):([\w.\-]+(?:\/[\w.\-]+)?)$/i.exec(value);
    return !!match && KEY_PROVIDERS.includes(match[1]!.toLowerCase()) && match[2]!.length <= 80;
}
const MAX_EXTRA = 1_500;

/** Anything malformed is dropped rather than half-applied. */
export function parseConfig(raw: unknown): SpecialistConfig {
    const config: SpecialistConfig = {};
    const specialists = (raw as { specialists?: Record<string, unknown> } | undefined)?.specialists;
    if (!specialists || typeof specialists !== 'object') {
        return config;
    }
    for (const specialist of SPECIALISTS) {
        const entry = specialists[specialist.id] as Record<string, unknown> | undefined;
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const model = typeof entry.model === 'string' && validModel(entry.model.trim()) ? entry.model.trim() : '';
        const extra = typeof entry.extra === 'string' ? entry.extra.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, MAX_EXTRA) : '';
        config[specialist.id] = { enabled: entry.enabled !== false, extra, model };
    }
    return config;
}

/** One entry of the reference library, as the site publishes it. */
export interface RemoteReference {
    id: string;
    kind: 'blueprint' | 'design' | 'docs';
    name: string;
    tags: string[];
    points: string[];
}

const MAX_REFERENCES = 300;
const strip = (value: unknown, max: number) =>
    typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** The same strict checks as the site: this text reaches the agent's instructions. */
export function parseReferences(raw: unknown): RemoteReference[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const out: RemoteReference[] = [];
    for (const entry of raw.slice(0, MAX_REFERENCES)) {
        const r = (entry ?? {}) as Record<string, unknown>;
        const kind = r.kind === 'blueprint' || r.kind === 'design' || r.kind === 'docs' ? r.kind : undefined;
        const id = strip(r.id, 60).replace(/[^\w-]/g, '');
        const name = strip(r.name, 120);
        const tags = (Array.isArray(r.tags) ? r.tags : []).map((t) => strip(t, 40).toLowerCase()).filter((t) => t.length >= 2).slice(0, 24);
        const points = (Array.isArray(r.points) ? r.points : []).map((p) => strip(p, 400)).filter((p) => p.length >= 8).slice(0, 12);
        if (kind && id && name && tags.length && points.length) {
            out.push({ id, kind, name, tags, points });
        }
    }
    return out;
}

/** The ids the admin has left on; every specialist when nothing is configured. */
export function enabledSpecialists(config: SpecialistConfig): Set<string> {
    return new Set(SPECIALISTS.filter((s) => config[s.id]?.enabled !== false).map((s) => s.id));
}

export class RemoteConfig {
    private config: SpecialistConfig;

    private library: RemoteReference[];

    constructor(private readonly context: vscode.ExtensionContext) {
        this.config = parseConfig({ specialists: context.globalState.get(STATE) });
        this.library = parseReferences(context.globalState.get(REFERENCES));
    }

    /** The reference library from the last download; matched to tasks on this machine. */
    get references(): RemoteReference[] {
        return this.library;
    }

    get current(): SpecialistConfig {
        return this.config;
    }

    /** Refreshes in the background if a day has passed. Never throws, never blocks a task. */
    /** The newest released version, as the site last reported it. */
    latest?: string;

    refresh(onLatest?: (latest: string | undefined) => void): void {
        const specialists = vscode.workspace.getConfiguration('freeagentcoder').get<boolean>('specialistUpdates', true);
        const last = this.context.globalState.get<number>(FETCHED) ?? 0;
        if (Date.now() - last < EVERY_MS) {
            return;
        }
        void (async () => {
            try {
                const response = await fetch(`${SITE_URL}/api/config`, { signal: AbortSignal.timeout(8_000) });
                if (!response.ok) {
                    return;
                }
                const body = (await response.json()) as { latest?: unknown };
                this.latest = typeof body.latest === 'string' ? body.latest : undefined;
                onLatest?.(this.latest);
                if (specialists) {
                    const parsed = parseConfig(body);
                    this.config = parsed;
                    await this.context.globalState.update(STATE, parsed);
                    const library = parseReferences((body as { references?: unknown }).references);
                    // An empty or missing list (an older site) keeps the last good library.
                    if (library.length) {
                        this.library = library;
                        await this.context.globalState.update(REFERENCES, library);
                    }
                }
                await this.context.globalState.update(FETCHED, Date.now());
            } catch {
                // Offline or the site is down: keep the last good config.
            }
        })();
    }
}
