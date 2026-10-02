import type { Metadata } from 'next';
import { isSignedIn } from '@/lib/admin';
import { settingsNeedStore, NO_STORE_MESSAGE } from '@/lib/kv';
import { GROUPS, readRoadmap, roadmapItems } from '@/lib/roadmap';
import { addAction, noteAction, removeAction, restoreAction, toggleAction } from './actions';

export const metadata: Metadata = { title: 'Roadmap', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/** What to do, build, test, verify and research next, with ticks and notes that are kept. */
export default async function RoadmapPage() {
    if (!(await isSignedIn())) {
        return (
            <main className="mx-auto max-w-3xl px-4 py-16 text-fg">
                <p>
                    Sign in on <a href="/admin" className="text-accent underline">the admin page</a> first.
                </p>
            </main>
        );
    }
    const state = await readRoadmap();
    const items = roadmapItems(state);
    const total = items.length;
    const done = items.filter((item) => state.done[item.id]).length;

    return (
        <main className="mx-auto w-full max-w-5xl px-4 py-10 text-fg">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h1 className="text-2xl font-semibold tracking-tight">Roadmap</h1>
                <div className="flex gap-4 text-[13px]">
                    <a href="/admin/lab" className="text-muted hover:text-fg">Test lab</a>
                    <a href="/admin" className="text-muted hover:text-fg">← Admin</a>
                </div>
            </div>
            <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-muted">
                What to do now, what to verify and test, what to build next, where to research, and what lies further out. Ticks and notes are saved and are the same on
                every device.
            </p>
            {settingsNeedStore && <p className="mt-3 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-[13px] text-bad">{NO_STORE_MESSAGE}</p>}

            <div className="mt-6 flex items-center gap-3 text-[13px] text-muted">
                <div className="h-1.5 w-60 overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
                </div>
                {done} of {total} done
                <nav className="ml-auto flex flex-wrap gap-3">
                    {GROUPS.map((g) => (
                        <a key={g.id} href={`#${g.id}`} className="hover:text-fg">
                            {g.title}
                        </a>
                    ))}
                </nav>
            </div>

            {GROUPS.map((group) => {
                const list = items.filter((item) => item.group === group.id);
                const open = list.filter((item) => !state.done[item.id]);
                const finished = list.filter((item) => state.done[item.id]);
                return (
                    <section key={group.id} id={group.id} className="mt-10 scroll-mt-6">
                        <div className="flex items-baseline gap-3">
                            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{group.title}</h2>
                            <span className="text-[12px] text-muted">
                                {finished.length}/{list.length}
                            </span>
                        </div>
                        <p className="mt-1 text-[13px] text-muted">{group.blurb}</p>
                        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
                            {[...open, ...finished].map((item) => {
                                const at = state.done[item.id];
                                const added = item.id.startsWith('a-');
                                return (
                                    <li key={item.id} className="flex gap-3 px-4 py-3">
                                        <form action={toggleAction}>
                                            <input type="hidden" name="id" value={item.id} />
                                            <button
                                                type="submit"
                                                aria-label={at ? 'Mark as not done' : 'Mark as done'}
                                                className={`mt-0.5 flex size-5 items-center justify-center rounded border text-[12px] ${at ? 'border-accent bg-accent text-white' : 'border-line hover:border-accent'}`}
                                            >
                                                {at ? '✓' : ''}
                                            </button>
                                        </form>
                                        <div className="min-w-0 flex-1">
                                            <p className={`text-[14px] ${at ? 'text-muted line-through' : 'font-medium'}`}>{item.title}</p>
                                            {item.detail && <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{item.detail}</p>}
                                            {item.where && <p className="mt-1 font-mono text-[12px] text-muted">{item.where}</p>}
                                            {at && <p className="mt-1 text-[11.5px] text-muted">Done {new Date(at).toISOString().slice(0, 10)}</p>}
                                            <details className="mt-1">
                                                <summary className="cursor-pointer text-[12px] text-muted hover:text-fg">{state.notes[item.id] ? 'Note' : 'Add a note'}</summary>
                                                <form action={noteAction} className="mt-2 flex gap-2">
                                                    <input type="hidden" name="id" value={item.id} />
                                                    <textarea
                                                        name="note"
                                                        defaultValue={state.notes[item.id] ?? ''}
                                                        rows={2}
                                                        className="min-w-0 flex-1 rounded-md border border-line bg-bg px-2 py-1.5 text-[13px] outline-none focus:border-accent"
                                                    />
                                                    <button type="submit" className="self-start rounded-md border border-line px-3 py-1.5 text-[12px] hover:border-accent">
                                                        Save
                                                    </button>
                                                </form>
                                            </details>
                                            {state.notes[item.id] && <p className="mt-1 whitespace-pre-wrap rounded bg-bg px-2 py-1 text-[12.5px]">{state.notes[item.id]}</p>}
                                        </div>
                                        <form action={removeAction}>
                                            <input type="hidden" name="id" value={item.id} />
                                            <button type="submit" className="text-[12px] text-muted hover:text-bad" title={added ? 'Delete' : 'Hide from the list'}>
                                                ×
                                            </button>
                                        </form>
                                    </li>
                                );
                            })}
                            {!list.length && <li className="px-4 py-3 text-[13px] text-muted">Nothing here.</li>}
                        </ul>
                    </section>
                );
            })}

            <section className="mt-10 rounded-lg border border-line bg-panel p-4">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Add an item</h2>
                <form action={addAction} className="mt-3 grid gap-2 sm:grid-cols-[10rem_1fr]">
                    <select name="group" className="rounded-md border border-line bg-bg px-2 py-2 text-[13px]">
                        {GROUPS.map((g) => (
                            <option key={g.id} value={g.id}>
                                {g.title}
                            </option>
                        ))}
                    </select>
                    <input name="title" required placeholder="What needs doing" className="rounded-md border border-line bg-bg px-3 py-2 text-[13px] outline-none focus:border-accent" />
                    <textarea
                        name="detail"
                        rows={2}
                        placeholder="Details, how to check it (optional)"
                        className="rounded-md border border-line bg-bg px-3 py-2 text-[13px] outline-none focus:border-accent sm:col-start-2"
                    />
                    <button type="submit" className="justify-self-start rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-white sm:col-start-2">
                        Add
                    </button>
                </form>
                {state.removed.length > 0 && (
                    <form action={restoreAction} className="mt-4">
                        <button type="submit" className="text-[12px] text-muted underline hover:text-fg">
                            Show {state.removed.length} hidden item{state.removed.length === 1 ? '' : 's'} again
                        </button>
                    </form>
                )}
            </section>
        </main>
    );
}
