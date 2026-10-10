import type { Metadata } from 'next';
import { isSignedIn } from '@/lib/admin';
import { MAX_REFERENCES, readReferences, type ReferenceKind } from '@/lib/references';
import { settingsNeedStore, NO_STORE_MESSAGE } from '@/lib/kv';
import { AddReference } from './add-form';
import { deleteReferenceAction, saveReferenceAction, toggleReferenceAction } from './actions';

export const metadata: Metadata = { title: 'Reference library', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const KIND: Record<ReferenceKind, string> = { blueprint: 'Blueprint', design: 'Design', docs: 'Docs' };

export default async function ReferencesPage() {
    if (!(await isSignedIn())) {
        return (
            <main className="mx-auto max-w-3xl px-4 py-16 text-fg">
                <p>
                    Sign in on <a href="/admin" className="text-accent underline">the admin page</a> first.
                </p>
            </main>
        );
    }
    const list = await readReferences();
    const counts = (kind: ReferenceKind) => list.filter((r) => r.kind === kind && r.enabled).length;

    return (
        <main className="mx-auto w-full max-w-5xl px-4 py-10 text-fg">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h1 className="text-2xl font-semibold tracking-tight">Reference library</h1>
                <div className="flex gap-4 text-[13px]">
                    <a href="/admin/lab" className="text-muted hover:text-fg">Test lab</a>
                    <a href="/admin" className="text-muted hover:text-fg">← Admin</a>
                </div>
            </div>
            <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-muted">
                How strong solutions are built, condensed from reference projects, websites and documents into a few rules each. The extension downloads the
                enabled entries once a day and adds the ones that fit a task, on the user&rsquo;s machine; nothing about the user&rsquo;s request is sent here. Fyxable
                uses the design entries when it builds a site.
            </p>
            {settingsNeedStore && <p className="mt-3 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-[13px] text-bad">{NO_STORE_MESSAGE}</p>}
            <p className="mt-3 text-[13px] text-muted">
                {list.length} of {MAX_REFERENCES} · in use: {counts('blueprint')} blueprints, {counts('design')} designs, {counts('docs')} docs
            </p>

            <section className="mt-6">
                <AddReference />
            </section>

            <section className="mt-8 grid gap-3">
                {list.map((r) => (
                    <details key={r.id} className={`min-w-0 overflow-hidden rounded-lg border border-line bg-panel p-4 ${r.enabled ? '' : 'opacity-60'}`}>
                        <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1">
                            <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-muted">{KIND[r.kind]}</span>
                            <span className="text-[14px] font-semibold">{r.name}</span>
                            <span className="text-[12px] text-faint">{r.enabled ? `${r.points.length} rules` : 'off'}</span>
                            <span className="block w-full truncate text-[12px] text-faint">{r.tags.join(', ')}</span>
                        </summary>
                        <form action={saveReferenceAction} className="mt-3 grid gap-2">
                            <input type="hidden" name="id" value={r.id} />
                            <input name="name" defaultValue={r.name} className="rounded-md border border-line bg-bg px-2 py-1.5 text-[13px]" />
                            <label className="text-[12px] text-muted">
                                Tags — what in a request makes this entry fit (comma or line separated)
                                <textarea name="tags" rows={2} defaultValue={r.tags.join(', ')} className="mt-1 w-full rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[12.5px] text-fg" />
                            </label>
                            <label className="text-[12px] text-muted">
                                Rules — one per line
                                <textarea name="points" rows={Math.min(14, r.points.length + 2)} defaultValue={r.points.join('\n')} className="mt-1 w-full rounded-md border border-line bg-bg px-2 py-1.5 text-[13px] text-fg" />
                            </label>
                            <p className="text-[12px] text-faint">From {r.source} · {new Date(r.addedAt).toISOString().slice(0, 10)}</p>
                            <div className="flex gap-3">
                                <button type="submit" className="rounded-md border border-line px-3 py-1.5 text-[12px] hover:border-accent">
                                    Save
                                </button>
                            </div>
                        </form>
                        <div className="mt-2 flex gap-4">
                            <form action={toggleReferenceAction}>
                                <input type="hidden" name="id" value={r.id} />
                                <button type="submit" className="text-[12px] text-muted hover:text-fg">
                                    {r.enabled ? 'Turn off' : 'Turn on'}
                                </button>
                            </form>
                            <form action={deleteReferenceAction}>
                                <input type="hidden" name="id" value={r.id} />
                                <button type="submit" className="text-[12px] text-bad hover:underline">
                                    Delete
                                </button>
                            </form>
                        </div>
                    </details>
                ))}
                {!list.length && <p className="text-[13px] text-muted">Nothing yet. Add a repository, a website or a document above.</p>}
            </section>
        </main>
    );
}
