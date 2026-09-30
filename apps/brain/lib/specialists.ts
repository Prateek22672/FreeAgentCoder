import 'server-only';
import { NO_STORE_MESSAGE, settingsNeedStore, store } from './kv';

/**
 * How the extension's specialists are tuned from the admin page. The ids and
 * names mirror freeagentcoder/src/agent/specialists.ts; the extension validates
 * everything it receives again, so a mistake here can only switch things off,
 * never break a task.
 */

export const SPECIALIST_INFO = [
    { id: 'fix', name: 'Debugging', about: 'Reproduce first, fix the cause, prove it with a test.' },
    { id: 'build', name: 'Building', about: 'New features and projects, end to end, nothing faked.' },
    { id: 'design', name: 'Interface design', about: 'Match the design system, check phone width, stay accessible.' },
    { id: 'refactor', name: 'Refactoring', about: 'Behaviour must not change; tests before and after.' },
    { id: 'data', name: 'Data and ML', about: 'Seeds, held-out data, a baseline, real metrics.' },
    { id: 'explain', name: 'Explaining', about: 'Answer from the code, cite files, change nothing.' },
] as const;

export type SpecialistId = (typeof SPECIALIST_INFO)[number]['id'];

export interface SpecialistSetting {
    enabled: boolean;
    extra: string;
    model: string;
}

const KEY = 'pb:specialists';
const TEN_YEARS = 10 * 365 * 24 * 60 * 60;

export async function readSpecialists(): Promise<Record<SpecialistId, SpecialistSetting>> {
    const [raw] = await store.getMany([KEY]);
    let saved: Partial<Record<string, Partial<SpecialistSetting>>> = {};
    try {
        saved = raw ? JSON.parse(raw) : {};
    } catch {
        saved = {};
    }
    return Object.fromEntries(
        SPECIALIST_INFO.map(({ id }) => [id, { enabled: saved[id]?.enabled !== false, extra: saved[id]?.extra ?? '', model: saved[id]?.model ?? '' }]),
    ) as Record<SpecialistId, SpecialistSetting>;
}

export async function writeSpecialists(settings: Record<string, SpecialistSetting>): Promise<string | undefined> {
    if (settingsNeedStore) return NO_STORE_MESSAGE;
    const clean: Record<string, SpecialistSetting> = {};
    for (const { id, name } of SPECIALIST_INFO) {
        const s = settings[id];
        if (!s) continue;
        const model = s.model.trim();
        if (model && !/^[a-z]+:[\w.\-]+(?:\/[\w.\-]+)?$/i.test(model)) {
            return `${name}: the model must look like provider:model-id, for example gemini:gemini-3.8-flash.`;
        }
        clean[id] = { enabled: s.enabled, extra: s.extra.trim().slice(0, 1_500), model };
    }
    await store.put(KEY, JSON.stringify(clean), TEN_YEARS);
    return undefined;
}
