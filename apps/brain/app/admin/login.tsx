'use client';

import { useActionState } from 'react';
import { signInAction, type SignInState } from './actions';

export function Login({ configured }: { configured: boolean }) {
    const [state, action, pending] = useActionState<SignInState | undefined, FormData>(signInAction, undefined);

    return (
        <div className="mx-auto mt-24 max-w-sm">
            <h1 className="text-center font-display text-xl font-semibold tracking-tight">Admin</h1>
            <p className="mt-2 text-center text-sm text-muted">
                {configured ? 'Enter the password to see the numbers.' : 'No password is set on this deployment yet.'}
            </p>
            <form action={action} className="mt-6 flex flex-col gap-3">
                <input
                    type="password"
                    name="password"
                    autoFocus
                    autoComplete="current-password"
                    placeholder="Password"
                    aria-label="Admin password"
                    className="h-11 rounded-md border border-line-strong bg-panel px-3 text-[15px] text-fg outline-none placeholder:text-faint focus:border-accent"
                />
                <button
                    type="submit"
                    disabled={pending}
                    className="h-11 rounded-md bg-accent px-4 text-[15px] font-semibold text-accent-fg hover:brightness-110 disabled:opacity-60"
                >
                    {pending ? 'Checking…' : 'Sign in'}
                </button>
            </form>
            {state?.error ? <p className="mt-3 text-center text-sm text-bad">{state.error}</p> : null}
            {!configured ? (
                <p className="mt-6 rounded-lg border border-line bg-panel p-3 text-center text-[13px] text-muted">
                    Add <code className="font-mono text-fg">ADMIN_PASSWORD</code> in the deployment&rsquo;s environment variables, then redeploy.
                </p>
            ) : null}
        </div>
    );
}
