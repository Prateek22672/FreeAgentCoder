'use client';

import { useActionState } from 'react';
import type { LabTask } from '@/lib/lab';
import { saveTaskAction, type LabFormState } from './actions';

const field = 'w-full rounded-md border border-line-strong bg-panel px-3 py-2 text-[14px] text-fg outline-none placeholder:text-faint focus:border-accent';
const label = 'block text-[11px] font-semibold uppercase tracking-wide text-muted';

/** Adds a task, or edits one when `task` is given. Follow-up prompts are separated by a line of three dashes. */
export function TaskForm({ task }: { task?: LabTask }) {
    const [state, action, pending] = useActionState<LabFormState | undefined, FormData>(saveTaskAction, undefined);
    return (
        <form action={action} className="grid gap-3 rounded-lg border border-line bg-panel p-4">
            {task && <input type="hidden" name="id" value={task.id} />}
            <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                <div>
                    <span className={label}>Title</span>
                    <input name="title" defaultValue={task?.title} placeholder="Web: a portfolio site" className={`${field} mt-1 h-10`} />
                </div>
                <div>
                    <span className={label}>Kind</span>
                    <select name="category" defaultValue={task?.category ?? 'app'} className={`${field} mt-1 h-10`}>
                        <option value="app">App development</option>
                        <option value="web">Web</option>
                        <option value="ml">Machine learning</option>
                        <option value="followup">Follow-ups</option>
                        <option value="other">Other</option>
                    </select>
                </div>
            </div>
            <div>
                <span className={label}>Prompts — put follow-ups on their own, separated by a line with ---</span>
                <textarea name="prompts" rows={5} defaultValue={task?.prompts.join('\n---\n')} placeholder={'Build a counter page.\n---\nAdd a reset button.'} className={`${field} mt-1 font-mono text-[13px]`} />
            </div>
            <div>
                <span className={label}>What a good result looks like</span>
                <textarea name="expect" rows={2} defaultValue={task?.expect} className={`${field} mt-1`} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2 sm:items-end">
                <div>
                    <span className={label}>Starter files (text, up to 200 KB each)</span>
                    <input name="files" type="file" multiple className="mt-1 block w-full text-[13px] text-muted file:mr-3 file:rounded-md file:border-0 file:bg-panel-2 file:px-3 file:py-1.5 file:text-fg" />
                    {task && Object.keys(task.files).length > 0 && (
                        <span className="mt-1 block text-[12px] text-faint">Has: {Object.keys(task.files).join(', ')}</span>
                    )}
                </div>
                {task && Object.keys(task.files).length > 0 && (
                    <label className="flex items-center gap-2 text-[13px] text-muted">
                        <input type="checkbox" name="clearFiles" className="size-4" /> Replace the files instead of adding to them
                    </label>
                )}
            </div>
            <div className="flex items-center gap-3">
                <button type="submit" disabled={pending} className="h-10 rounded-md bg-accent px-4 text-[14px] font-semibold text-accent-fg disabled:opacity-60">
                    {pending ? 'Saving…' : task ? 'Save task' : 'Add task'}
                </button>
                {state?.error && <span className="text-[13px] text-bad">{state.error}</span>}
                {state?.saved && <span className="text-[13px] text-ok">Saved.</span>}
            </div>
        </form>
    );
}
