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
    const result = await addPoolKey(String(form.get('provider') ?? ''), String(form.get('label') ?? ''), String(form.get('key') ?? ''));
    if ('error' in result) return { error: result.error };
    revalidatePath('/admin');
    return { saved: true };
}

export async function checkKeysAction(form: FormData): Promise<void> {
    if (!(await isSignedIn())) return;
    const id = String(form.get('id') ?? '');
    // One key, or every key when no id is given.
    // Pressing Check sends one real request per key, to prove it answers and to read its limits.
    await checkPoolKeys(id ? [id] : (await listPool()).map((k) => k.id), 0, true);
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
    });
    if (error) return { error };
    revalidatePath('/admin');
    return { saved: true };
}
