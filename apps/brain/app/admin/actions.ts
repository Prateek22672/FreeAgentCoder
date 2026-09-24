'use server';

import { revalidatePath } from 'next/cache';
import { signIn, signOut } from '@/lib/admin';

export interface SignInState {
    error?: string;
}

const MESSAGES = {
    wrong: 'That password is not right.',
    locked: 'Too many attempts. Try again later.',
    unset: 'No password is set on this deployment. Add ADMIN_PASSWORD to the environment and redeploy.',
    empty: 'Enter the password.',
};

export async function signInAction(_state: SignInState | undefined, form: FormData): Promise<SignInState> {
    const password = String(form.get('password') ?? '');
    if (!password) {
        return { error: MESSAGES.empty };
    }
    const result = await signIn(password);
    if (result !== 'ok') {
        return { error: MESSAGES[result] };
    }
    revalidatePath('/admin');
    return {};
}

export async function signOutAction(): Promise<void> {
    await signOut();
    revalidatePath('/admin');
}
