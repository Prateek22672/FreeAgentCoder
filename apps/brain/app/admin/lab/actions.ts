'use server';

import { revalidatePath } from 'next/cache';
import { isSignedIn } from '@/lib/admin';
import { DEFAULT_TASKS, deleteResult, rateResult, readTasks, writeTasks, type LabCategory, type LabTask } from '@/lib/lab';

export interface LabFormState {
    error?: string;
    saved?: boolean;
}

const CATEGORIES: LabCategory[] = ['app', 'web', 'ml', 'followup', 'other'];
const MAX_FILE = 200_000;
const MAX_FILES_TOTAL = 900_000;

/** Adds or replaces a task. Uploaded files are added to the ones it already has; text files only. */
export async function saveTaskAction(_state: LabFormState | undefined, form: FormData): Promise<LabFormState> {
    if (!(await isSignedIn())) return { error: 'Sign in first.' };
    const title = String(form.get('title') ?? '').trim().slice(0, 120);
    const prompts = String(form.get('prompts') ?? '')
        .split(/\n\s*---\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .slice(0, 10);
    if (!title || !prompts.length) return { error: 'Give the task a title and at least one prompt.' };
    const category = (CATEGORIES.includes(String(form.get('category')) as LabCategory) ? form.get('category') : 'other') as LabCategory;
    const id = String(form.get('id') ?? '').trim() || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `task-${Date.now()}`;
    const tasks = await readTasks();
    const existing = tasks.find((t) => t.id === id);
    const files: Record<string, string> = form.get('clearFiles') === 'on' ? {} : { ...(existing?.files ?? {}) };
    for (const entry of form.getAll('files')) {
        if (!(entry instanceof File) || !entry.size) continue;
        if (entry.size > MAX_FILE) return { error: `${entry.name} is over 200 KB. Upload smaller text files.` };
        const text = await entry.text();
        if (text.includes('\u0000')) return { error: `${entry.name} looks like a binary file. Upload text files only.` };
        const path = (entry.webkitRelativePath || entry.name).replace(/\\/g, '/').replace(/^\/+/, '');
        if (!/^[\w.@+\-/ ]{1,200}$/.test(path) || path.includes('..')) return { error: `${entry.name} has a name that cannot be used.` };
        files[path] = text;
    }
    if (Object.values(files).reduce((s, f) => s + f.length, 0) > MAX_FILES_TOTAL) return { error: 'The files add up to over 900 KB. Keep test projects small.' };
    const checklist = String(form.get('checklist') ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 40)
        .map((line) => line.slice(0, 200));
    const task: LabTask = {
        id,
        title,
        category,
        prompts,
        files,
        expect: String(form.get('expect') ?? '').trim().slice(0, 1000),
        ...(checklist.length ? { checklist } : {}),
        // The benchmark is set in code; editing a task keeps it.
        ...(existing?.benchmark ? { benchmark: existing.benchmark } : {}),
    };
    await writeTasks(existing ? tasks.map((t) => (t.id === id ? task : t)) : [...tasks, task]);
    revalidatePath('/admin/lab');
    return { saved: true };
}

export async function deleteTaskAction(form: FormData): Promise<void> {
    if (!(await isSignedIn())) return;
    const id = String(form.get('id') ?? '');
    await writeTasks((await readTasks()).filter((t) => t.id !== id));
    revalidatePath('/admin/lab');
}

export async function restoreDefaultsAction(): Promise<void> {
    if (!(await isSignedIn())) return;
    const tasks = await readTasks();
    await writeTasks([...tasks.filter((t) => !DEFAULT_TASKS.some((d) => d.id === t.id)), ...DEFAULT_TASKS]);
    revalidatePath('/admin/lab');
}

export async function rateAction(form: FormData): Promise<void> {
    if (!(await isSignedIn())) return;
    const clamp = (v: unknown) => Math.max(1, Math.min(5, Math.round(Number(v) || 0)));
    await rateResult(String(form.get('id') ?? ''), {
        understood: clamp(form.get('understood')),
        quality: clamp(form.get('quality')),
        notes: String(form.get('notes') ?? '').slice(0, 2000),
        passed: form
            .getAll('passed')
            .map((v) => Math.floor(Number(v)))
            .filter((n) => Number.isInteger(n) && n >= 0 && n < 100),
    });
    revalidatePath('/admin/lab');
}

export async function deleteResultAction(form: FormData): Promise<void> {
    if (!(await isSignedIn())) return;
    await deleteResult(String(form.get('id') ?? ''));
    revalidatePath('/admin/lab');
}
