import type { Metadata } from 'next';
import { isSignedIn } from '@/lib/admin';
import { labToken, listResults, readResult, readTasks, report } from '@/lib/lab';
import { deleteResultAction, deleteTaskAction, rateAction, restoreDefaultsAction } from './actions';
import { TaskForm } from './task-form';

export const metadata: Metadata = { title: 'Test lab', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const KIND: Record<string, string> = { app: 'App development', web: 'Web', ml: 'Machine learning', followup: 'Follow-ups', other: 'Other' };
const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;

export default async function LabPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
    if (!(await isSignedIn())) {
        return (
            <main className="mx-auto max-w-3xl px-4 py-16 text-fg">
                <p>
                    Sign in on <a href="/admin" className="text-accent underline">the admin page</a> first.
                </p>
            </main>
        );
    }
    const { run } = await searchParams;
    const [tasks, results] = await Promise.all([readTasks(), listResults()]);
    const open = run ? await readResult(run) : undefined;
    const rows = report(results);

    return (
        <main className="mx-auto w-full max-w-6xl px-4 py-10 text-fg">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h1 className="text-2xl font-semibold tracking-tight">Test lab</h1>
                <a href="/admin" className="text-[13px] text-muted hover:text-fg">← Admin</a>
            </div>
            <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-muted">
                Fixed tasks to measure how well the extension works. In VS Code, open an empty folder, run <b className="text-fg">FreeAgentCoder: Run a Test Task</b>, and pick
                one. The extension writes the task&rsquo;s files, sends its prompts one after another, and posts the run here.
            </p>

            <section className="mt-6 rounded-lg border border-line bg-panel p-4 text-[13px]">
                <p className="font-semibold text-fg">Lab token</p>
                <p className="mt-1 text-muted">
                    Put this in VS Code settings as <code className="font-mono text-fg">freeagentcoder.labToken</code>. It changes if the admin password or key secret changes.
                </p>
                <code className="mt-2 block select-all break-all rounded bg-bg px-3 py-2 font-mono text-fg">{labToken() ?? 'Set ADMIN_PASSWORD first.'}</code>
            </section>

            <section className="mt-8">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Report</h2>
                {rows.length ? (
                    <div className="overflow-x-auto rounded-lg border border-line">
                        <table className="w-full text-[13px] tabular-nums">
                            <thead className="bg-panel text-left text-[11px] uppercase tracking-wide text-muted">
                                <tr>
                                    {['Kind', 'Runs', 'Finished', 'Avg time a prompt', 'Avg tokens', 'Avg requests', 'Understood /5', 'Quality /5'].map((h) => (
                                        <th key={h} className="px-3 py-2">
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.category} className="border-t border-line text-muted">
                                        <td className="px-3 py-2 text-fg">{KIND[r.category] ?? r.category}</td>
                                        <td className="px-3 py-2">{r.runs}</td>
                                        <td className="px-3 py-2">
                                            {r.completed} of {r.runs}
                                        </td>
                                        <td className="px-3 py-2">{r.avgSeconds} s</td>
                                        <td className="px-3 py-2">{r.avgTokens.toLocaleString('en-US')}</td>
                                        <td className="px-3 py-2">{r.avgRequests}</td>
                                        <td className="px-3 py-2">{r.understood ?? 'not rated'}</td>
                                        <td className="px-3 py-2">{r.quality ?? 'not rated'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <p className="text-[13px] text-muted">No runs yet.</p>
                )}
            </section>

            <section className="mt-8">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Runs</h2>
                <div className="overflow-x-auto rounded-lg border border-line">
                    <table className="w-full text-[13px] tabular-nums">
                        <thead className="bg-panel text-left text-[11px] uppercase tracking-wide text-muted">
                            <tr>
                                {['When', 'Task', 'Prompts', 'Outcome', 'Time', 'Tokens', 'Requests', 'Rated', ''].map((h) => (
                                    <th key={h} className="px-3 py-2">
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {results.map((r) => (
                                <tr key={r.id} className={`border-t border-line text-muted ${open?.id === r.id ? 'bg-panel-2' : ''}`}>
                                    <td className="px-3 py-2">{new Date(r.at).toISOString().slice(0, 16).replace('T', ' ')}</td>
                                    <td className="px-3 py-2 text-fg">{r.title}</td>
                                    <td className="px-3 py-2">{r.turns.length}</td>
                                    <td className="px-3 py-2">{r.turns.map((t) => t.reason).join(', ')}</td>
                                    <td className="px-3 py-2">{seconds(r.turns.reduce((s, t) => s + t.durationMs, 0))}</td>
                                    <td className="px-3 py-2">{r.turns.reduce((s, t) => s + t.tokens, 0).toLocaleString('en-US')}</td>
                                    <td className="px-3 py-2">{r.turns.reduce((s, t) => s + t.requests, 0)}</td>
                                    <td className="px-3 py-2">{r.rating ? `${r.rating.understood} / ${r.rating.quality}` : '—'}</td>
                                    <td className="px-3 py-2">
                                        <a href={`/admin/lab?run=${r.id}#run`} className="text-accent hover:underline">
                                            Open
                                        </a>
                                    </td>
                                </tr>
                            ))}
                            {!results.length && (
                                <tr>
                                    <td colSpan={9} className="px-3 py-4 text-muted">
                                        Runs appear here as the extension posts them.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            {open && (
                <section id="run" className="mt-8 grid gap-4 rounded-lg border border-line bg-panel p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h2 className="text-[16px] font-semibold">{open.title}</h2>
                        <span className="text-[12px] text-faint">
                            Extension {open.extension} · {new Date(open.at).toISOString().slice(0, 16).replace('T', ' ')}
                        </span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-[12.5px] tabular-nums">
                            <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
                                <tr>
                                    {['Prompt', 'Outcome', 'Time', 'Tokens', 'Requests', 'Steps', 'Models', 'Files changed'].map((h) => (
                                        <th key={h} className="py-1 pr-3">
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {open.turns.map((t, i) => (
                                    <tr key={i} className="border-t border-line align-top text-muted">
                                        <td className="max-w-[280px] py-1.5 pr-3 text-fg">{t.prompt}</td>
                                        <td className="py-1.5 pr-3">{t.usedFyx ? `${t.reason} (Fyx)` : t.reason}</td>
                                        <td className="py-1.5 pr-3">{seconds(t.durationMs)}</td>
                                        <td className="py-1.5 pr-3">{t.tokens.toLocaleString('en-US')}</td>
                                        <td className="py-1.5 pr-3">{t.requests}</td>
                                        <td className="py-1.5 pr-3">{t.steps}</td>
                                        <td className="py-1.5 pr-3">{t.models.join(', ') || '—'}</td>
                                        <td className="py-1.5 pr-3 font-mono text-[11.5px]">{t.filesChanged.join(', ') || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <details open>
                        <summary className="cursor-pointer text-[13px] font-semibold">Conversation</summary>
                        <pre className="mt-2 max-h-[520px] overflow-auto whitespace-pre-wrap rounded bg-bg p-3 font-mono text-[12px] leading-relaxed text-muted">{open.transcript}</pre>
                    </details>
                    <form action={rateAction} className="grid gap-3 sm:grid-cols-[120px_120px_1fr_auto] sm:items-end">
                        <input type="hidden" name="id" value={open.id} />
                        {(['understood', 'quality'] as const).map((k) => (
                            <label key={k} className="text-[12px] text-muted">
                                {k === 'understood' ? 'Understood /5' : 'Quality /5'}
                                <select name={k} defaultValue={open.rating?.[k] ?? 3} className="mt-1 h-9 w-full rounded-md border border-line-strong bg-bg px-2 text-fg">
                                    {[1, 2, 3, 4, 5].map((n) => (
                                        <option key={n}>{n}</option>
                                    ))}
                                </select>
                            </label>
                        ))}
                        <label className="text-[12px] text-muted">
                            Notes
                            <input name="notes" defaultValue={open.rating?.notes} className="mt-1 h-9 w-full rounded-md border border-line-strong bg-bg px-2 text-fg" />
                        </label>
                        <button type="submit" className="h-9 rounded-md bg-accent px-4 text-[13px] font-semibold text-accent-fg">
                            Save rating
                        </button>
                    </form>
                    <form action={deleteResultAction}>
                        <input type="hidden" name="id" value={open.id} />
                        <button type="submit" className="text-[12px] text-bad hover:underline">
                            Delete this run
                        </button>
                    </form>
                </section>
            )}

            <section className="mt-10">
                <div className="mb-3 flex items-baseline justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Tasks</h2>
                    <form action={restoreDefaultsAction}>
                        <button type="submit" className="text-[12px] text-muted hover:text-fg">
                            Restore the built-in tasks
                        </button>
                    </form>
                </div>
                <div className="grid gap-4">
                    {tasks.map((task) => (
                        <details key={task.id} className="rounded-lg border border-line">
                            <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3 text-[14px]">
                                <span className="font-medium">{task.title}</span>
                                <span className="text-[12px] text-faint">
                                    {KIND[task.category]} · {task.prompts.length} prompt{task.prompts.length === 1 ? '' : 's'} · {Object.keys(task.files).length} file
                                    {Object.keys(task.files).length === 1 ? '' : 's'}
                                </span>
                            </summary>
                            <div className="grid gap-3 border-t border-line p-4">
                                <TaskForm task={task} />
                                <form action={deleteTaskAction}>
                                    <input type="hidden" name="id" value={task.id} />
                                    <button type="submit" className="text-[12px] text-bad hover:underline">
                                        Delete this task
                                    </button>
                                </form>
                            </div>
                        </details>
                    ))}
                </div>
                <h3 className="mb-2 mt-6 text-[13px] font-semibold">Add a task</h3>
                <TaskForm />
            </section>
        </main>
    );
}
