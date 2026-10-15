import 'server-only';
import { store } from './kv';

/**
 * A short log of what happened in the system, for the admin's System page:
 * a model failing for the trial, a pool key put to rest, a benchmark run.
 * One entry per event, kept 14 days. Never prompts or code: messages are
 * provider error texts, cut short and with anything key-like masked.
 */

export type EventLevel = 'error' | 'warn' | 'info';

export interface SystemEvent {
    at: number;
    /** What it is about, e.g. "trial:groq", "pool:gemini", "lab". */
    source: string;
    level: EventLevel;
    message: string;
}

const KEEP = 14 * 24 * 60 * 60;
const day = (offset = 0) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

export function maskSecrets(text: string): string {
    return text
        .replace(/\b(?:AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{16,}|gsk_[A-Za-z0-9]{16,}|nvapi-[A-Za-z0-9_-]{16,}|fact_[0-9a-f-]{36})\b/g, '[key]')
        .replace(/\b(Bearer)\s+\S+/gi, '$1 [key]');
}

export async function logEvent(source: string, level: EventLevel, message: string): Promise<void> {
    const event: SystemEvent = { at: Date.now(), source: source.slice(0, 40), level, message: maskSecrets(message).replace(/\s+/g, ' ').trim().slice(0, 240) };
    // A random tail keeps two identical events in the same millisecond apart.
    await store.addMember(`pb:events:${day()}`, `${JSON.stringify(event)}#${Math.random().toString(36).slice(2, 6)}`, KEEP).catch(() => undefined);
}

/** The newest events of the last `days` days, newest first. */
export async function recentEvents(days = 3, limit = 300): Promise<SystemEvent[]> {
    const lists = await Promise.all(Array.from({ length: days }, (_, i) => store.members(`pb:events:${day(i)}`, limit).catch(() => [] as string[])));
    const events: SystemEvent[] = [];
    for (const raw of lists.flat()) {
        try {
            const parsed = JSON.parse(raw.replace(/#[a-z0-9]{1,6}$/, '')) as SystemEvent;
            if (typeof parsed.at === 'number' && typeof parsed.message === 'string') events.push(parsed);
        } catch {
            // Not one of ours.
        }
    }
    return events.sort((a, b) => b.at - a.at).slice(0, limit);
}
