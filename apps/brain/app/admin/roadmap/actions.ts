'use server';

import { revalidatePath } from 'next/cache';
import { isSignedIn } from '@/lib/admin';
import { GROUPS, readRoadmap, writeRoadmap, type RoadmapGroup } from '@/lib/roadmap';

const PATH = '/admin/roadmap';

export async function toggleAction(form: FormData): Promise<void> {
    if (!(await isSignedIn())) return;
    const id = String(form.get('id') ?? '');
    if (!id) return;
    const state = await readRoadmap();
    if (state.done[id]) delete state.done[id];
    else state.done[id] = Date.now();
    await writeRoadmap(state);
    revalidatePath(PATH);
}

export async function noteAction(form: FormData): Promise<void> {
    if (!(await isSignedIn())) return;
    const id = String(form.get('id') ?? '');
    const note = String(form.get('note') ?? '').trim().slice(0, 1_000);
    if (!id) return;
    const state = await readRoadmap();
    if (note) state.notes[id] = note;
    else delete state.notes[id];
    await writeRoadmap(state);
    revalidatePath(PATH);
}

export async function addAction(form: FormData): Promise<void> {
    if (!(await isSignedIn())) return;
    const title = String(form.get('title') ?? '').trim().slice(0, 200);
    const group = String(form.get('group') ?? '') as RoadmapGroup;
    if (!title || !GROUPS.some((g) => g.id === group)) return;
    const detail = String(form.get('detail') ?? '').trim().slice(0, 1_000) || undefined;
    const state = await readRoadmap();
    state.added.push({ id: `a-${Date.now().toString(36)}`, group, title, detail });
    await writeRoadmap(state);
    revalidatePath(PATH);
}

export async function removeAction(form: FormData): Promise<void> {
    if (!(await isSignedIn())) return;
    const id = String(form.get('id') ?? '');
    if (!id) return;
    const state = await readRoadmap();
    state.added = state.added.filter((item) => item.id !== id);
    if (!state.removed.includes(id)) state.removed.push(id);
    delete state.done[id];
    delete state.notes[id];
    await writeRoadmap(state);
    revalidatePath(PATH);
}

export async function restoreAction(): Promise<void> {
    if (!(await isSignedIn())) return;
    const state = await readRoadmap();
    state.removed = [];
    await writeRoadmap(state);
    revalidatePath(PATH);
}
