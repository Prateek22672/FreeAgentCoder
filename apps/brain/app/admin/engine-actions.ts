'use server';

import { revalidatePath } from 'next/cache';
import { isSignedIn } from '@/lib/admin';
import { addPoolKey, checkPoolKeys, listPool, removePoolKey, setPoolKeyEnabled } from '@/lib/keypool';
import { SPECIALIST_INFO, writeSpecialists, type SpecialistSetting } from '@/lib/specialists';
import { writeExtTrialSettings } from '@/lib/extTrial';

export interface FormState {
    error?: string;
    saved?: boolean;
}

export async function addKeyAction(_state: FormState | undefined, form: FormData): Promise<FormState> {
    if (!(await isSignedIn())) return { error: 'Sign in first.' };
    const text = (name: string) => String(form.get(name) ?? '');
    const result = await addPoolKey(text('provider'), text('label'), text('key'), {
        name: text('customName'),
        baseURL: text('customBaseURL'),
        fast: text('customFast'),
        deep: text('customDeep'),
        contextWindow: Number(text('customContext')) || undefined,
        first: form.get('customFirst') === 'on',
    });
    if ('error' in result) return { error: result.error };
    revalidatePath('/admin');
    return { saved: true };
}

export async function checkKeysAction(form: FormData): Promise<void> {
    if (!(await isSignedIn())) return;
    const id = String(form.get('id') ?? '');
    // One key, or every key when no id is given.
    // Test sends one real request per key, to prove it answers and to read its limits; Validate only asks
    // whether the provider accepts the key (free: no tokens and no request against the allowance).
    await checkPoolKeys(id ? [id] : (await listPool()).map((k) => k.id), 0, form.get('mode') !== 'validate');
    revalidatePath('/admin');
}

export async function toggleKeyAction(form: FormData): Promise<void> {
    if (!(await isSignedIn())) return;
    await setPoolKeyEnabled(String(form.get('id') ?? ''), form.get('enabled') === 'true');
    revalidatePath('/admin');
}

export async function removeKeyAction(form: FormData): Promise<void> {
    if (!(await isSignedIn())) return;
    await removePoolKey(String(form.get('id') ?? ''));
    revalidatePath('/admin');
}

export async function saveSpecialistsAction(_state: FormState | undefined, form: FormData): Promise<FormState> {
    if (!(await isSignedIn())) return { error: 'Sign in first.' };
    const settings: Record<string, SpecialistSetting> = {};
    for (const { id } of SPECIALIST_INFO) {
        settings[id] = {
            enabled: form.get(`${id}.enabled`) === 'on',
            extra: String(form.get(`${id}.extra`) ?? ''),
            model: String(form.get(`${id}.model`) ?? ''),
        };
    }
    const error = await writeSpecialists(settings);
    if (error) return { error };
    revalidatePath('/admin');
    return { saved: true };
}

export async function saveExtTrialAction(_state: FormState | undefined, form: FormData): Promise<FormState> {
    if (!(await isSignedIn())) return { error: 'Sign in first.' };
    const error = await writeExtTrialSettings({
        enabled: form.get('enabled') === 'on',
        requestsPerInstall: Number(form.get('requestsPerInstall')),
        tokensPerInstall: Number(form.get('tokensPerInstall')),
        requestsPerAddress: Number(form.get('requestsPerAddress')),
        dailyCap: Number(form.get('dailyCap')),
        bonusTokens: Number(form.get('bonusTokens')),
        bonusesPerDay: Number(form.get('bonusesPerDay')),
    });
    if (error) return { error };
    revalidatePath('/admin');
    return { saved: true };
}
