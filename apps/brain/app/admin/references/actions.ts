'use server';

import { revalidatePath } from 'next/cache';
import { isSignedIn } from '@/lib/admin';
import { getRouter } from '@/lib/ai';
import {
    CONDENSE_SYSTEM,
    MAX_REFERENCES,
    completeText,
    condensePrompt,
    parseCondensed,
    readReferences,
    readSource,
    sanitizeReference,
    slug,
    writeReferences,
    type ReferenceKind,
} from '@/lib/references';

const PATH = '/admin/references';

export interface AddState {
    error?: string;
    added?: string;
}

/** Reads a repository, a site or pasted text, and has a model condense it into rules. */
export async function addReferenceAction(_state: AddState | undefined, form: FormData): Promise<AddState> {
    if (!(await isSignedIn())) return { error: 'Sign in first.' };
    const kind = String(form.get('kind') ?? '') as ReferenceKind;
    if (!['blueprint', 'design', 'docs'].includes(kind)) return { error: 'Pick what kind of reference this is.' };
    const input = String(form.get('source') ?? '').trim();
    if (input.length < 10) return { error: 'Paste a GitHub repository, a website address, or the text to learn from.' };
    const router = getRouter();
    if (!router) return { error: 'The site has no model key configured (GEMINI_API_KEY or another), so it cannot condense references.' };
    const list = await readReferences();
    if (list.length >= MAX_REFERENCES) return { error: `The library is full (${MAX_REFERENCES}). Delete some entries first.` };
    try {
        const source = await readSource(input);
        const reply = await completeText(router, CONDENSE_SYSTEM, condensePrompt(kind, source.title, source.text), AbortSignal.timeout(90_000));
        const condensed = parseCondensed(reply);
        if (!condensed) return { error: 'The model did not return usable rules. Try again, or paste a shorter text.' };
        const name = String(form.get('name') ?? '').trim() || condensed.name;
        let id = slug(name);
        while (list.some((r) => r.id === id)) id = `${id}-2`;
        const reference = sanitizeReference({ id, kind, name, tags: condensed.tags, points: condensed.points, source: source.source, addedAt: Date.now() });
        if (!reference) return { error: 'The result was empty after checking. Try again.' };
        await writeReferences([reference, ...list]);
        revalidatePath(PATH);
        return { added: reference.name };
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
}

export async function saveReferenceAction(form: FormData): Promise<void> {
    if (!(await isSignedIn())) return;
    const id = String(form.get('id') ?? '');
    const lines = (field: string) =>
        String(form.get(field) ?? '')
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
    const list = await readReferences();
    const next = list.map((r) =>
        r.id === id
            ? (sanitizeReference({ ...r, name: String(form.get('name') ?? r.name), tags: lines('tags').flatMap((l) => l.split(',')), points: lines('points') }) ?? r)
            : r,
    );
    await writeReferences(next);
    revalidatePath(PATH);
}

export async function toggleReferenceAction(form: FormData): Promise<void> {
    if (!(await isSignedIn())) return;
    const id = String(form.get('id') ?? '');
    await writeReferences((await readReferences()).map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
    revalidatePath(PATH);
}

export async function deleteReferenceAction(form: FormData): Promise<void> {
    if (!(await isSignedIn())) return;
    const id = String(form.get('id') ?? '');
    await writeReferences((await readReferences()).filter((r) => r.id !== id));
    revalidatePath(PATH);
}
