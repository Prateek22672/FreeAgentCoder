'use client';

import { useActionState } from 'react';
import { addReferenceAction, type AddState } from './actions';

const field = 'w-full rounded-md border border-line-strong bg-bg px-3 py-2 text-[13px] text-fg outline-none focus:border-accent';

export function AddReference() {
    const [state, action, pending] = useActionState<AddState | undefined, FormData>(addReferenceAction, undefined);
    return (
        <form action={action} className="grid gap-3 rounded-lg border border-line bg-panel p-4">
            <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                <label className="text-[12px] text-muted">
                    Kind
                    <select name="kind" defaultValue="blueprint" className={`${field} mt-1`}>
                        <option value="blueprint">Blueprint: how a project is built</option>
                        <option value="design">Design: how a site looks</option>
                        <option value="docs">Docs: how a library is used</option>
                    </select>
                </label>
                <label className="text-[12px] text-muted">
                    Name (optional; the model names it otherwise)
                    <input name="name" className={`${field} mt-1`} />
                </label>
            </div>
            <label className="text-[12px] text-muted">
                A GitHub repository, a website address, or the text to learn from
                <textarea name="source" rows={4} required placeholder={'https://github.com/owner/repo\nhttps://stripe.com\nor paste notes, a spec or documentation'} className={`${field} mt-1 font-mono`} />
            </label>
            <div className="flex flex-wrap items-center gap-3">
                <button type="submit" disabled={pending} className="h-9 rounded-md bg-accent px-4 text-[13px] font-semibold text-accent-fg disabled:opacity-60">
                    {pending ? 'Reading and condensing…' : 'Add to the library'}
                </button>
                {state?.error && <span className="text-[13px] text-bad">{state.error}</span>}
                {state?.added && <span className="text-[13px] text-ok">Added “{state.added}”. Review its rules below.</span>}
            </div>
        </form>
    );
}
