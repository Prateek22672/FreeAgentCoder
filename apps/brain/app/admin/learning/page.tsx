import type { Metadata } from 'next';
import { isSignedIn } from '@/lib/admin';
import {
    feedbackSummary,
    learnedOrder,
    learningAvailable,
    listErrors,
    listFyx,
    listLessons,
    MIN_TASKS,
    modelScores,
    REASONS,
    type ErrorRow,
    type FyxRow,
    type LessonRow,
    type ModelScore,
} from '@/lib/learning';
import { failingSteps, listResults, readTasks } from '@/lib/lab';
import { draftRuleAction, errorAction, fyxAction, lessonAction, tuneAction } from './actions';

export const metadata: Metadata = { title: 'Learning', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const REASON_LABEL: Record<string, string> = {
    'did-not-run': "Didn't run",
    'ignored-request': 'Ignored my request',
    'too-slow': 'Too slow',
    'looks-bad': 'Looks bad',
    'wrong-answer': 'Wrong answer',
    'too-many-tokens': 'Too many tokens',
};

const button = 'rounded-md border border-line px-2.5 py-1 text-[12px] hover:border-accent';

export default async function LearningPage() {
    if (!(await isSignedIn())) {
        return (
            <main className="mx-auto max-w-3xl px-4 py-16 text-fg">
                <p>
                    Sign in on <a href="/admin" className="text-accent underline">the admin page</a> first.
                </p>
            </main>
        );
    }
    let failure = '';
    const safe = <T,>(p: Promise<T>, fallback: T) =>
        p.catch((error: unknown) => {
            failure ||= error instanceof Error ? error.message : String(error);
            return fallback;
        });
    const [lessons, errors, fyx, scores, feedback, labTasks, labResults] = await Promise.all([
        safe(listLessons(), [] as LessonRow[]),
        safe(listErrors(), [] as ErrorRow[]),
        safe(listFyx(), [] as FyxRow[]),
        safe(modelScores(14), [] as ModelScore[]),
        safe(feedbackSummary(14), { good: 0, bad: 0, reasons: {} as Record<string, number> }),
        readTasks().catch(() => []),
        listResults().catch(() => []),
    ]);
    const failing = failingSteps(labTasks, labResults);
    const order = learnedOrder(scores);
    const pending = lessons.filter((l) => l.status === 'pending');
    const decided = lessons.filter((l) => l.status !== 'pending');
    const rated = feedback.good + feedback.bad;

    return (
        <main className="mx-auto w-full max-w-6xl px-4 py-10 text-fg">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h1 className="text-2xl font-semibold tracking-tight">Learning</h1>
                <div className="flex gap-4 text-[13px]">
                    <a href="/admin/learning/export" className="text-muted hover:text-fg">Export training data</a>
                    <a href="/admin/lab" className="text-muted hover:text-fg">Test lab</a>
                    <a href="/admin" className="text-muted hover:text-fg">← Admin</a>
                </div>
            </div>
            <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-muted">
                What installs that chose &ldquo;OK, start using the agent&rdquo; have taught it, merged across users. Approved lessons, error rules and Fyx chores go to every
                install in the next daily download; the model order below is applied automatically once a provider has {MIN_TASKS}+ tasks. Never code, files or prompts.
            </p>
            {!learningAvailable && (
                <p className="mt-3 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-[13px] text-bad">
                    Learning needs Supabase: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then run apps/brain/supabase/learning.sql once in the SQL editor.
                </p>
            )}
            {failure && (
                <p className="mt-3 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-[13px] text-bad">
                    Could not read the learning tables ({failure.slice(0, 160)}). If they do not exist yet, run apps/brain/supabase/learning.sql once in the Supabase SQL editor.
                </p>
            )}

            <section className="mt-8 grid gap-3 sm:grid-cols-4">
                {[
                    ['Lessons waiting', String(pending.length), `${decided.filter((l) => l.status === 'approved').length} approved`],
                    ['Recurring errors', String(errors.length), `${errors.filter((e) => e.status === 'approved').length} have an approved rule`],
                    ['Ratings, 14 days', rated ? `${Math.round((feedback.good / rated) * 100)}% 👍` : '—', `${feedback.good} up · ${feedback.bad} down`],
                    ['Fyx patterns', String(fyx.length), `${fyx.filter((f) => f.status === 'approved').length} shipped`],
                ].map(([label, value, hint]) => (
                    <div key={label} className="rounded-lg border border-line bg-panel p-4">
                        <div className="text-[12px] text-muted">{label}</div>
                        <div className="mt-1 text-xl font-semibold">{value}</div>
                        <div className="mt-1 text-[12px] text-faint">{hint}</div>
                    </div>
                ))}
            </section>

            <section className="mt-10">
                <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Lessons waiting for approval</h2>
                <p className="mb-3 text-[12.5px] text-muted">Learned from users&rsquo; corrections, merged by meaning. Edit the wording if needed, then approve to send it to everyone.</p>
                <div className="grid gap-2">
                    {pending.map((l) => (
                        <form key={l.hash} action={lessonAction} className="grid gap-2 rounded-lg border border-line bg-panel p-3 sm:grid-cols-[1fr_auto]">
                            <input type="hidden" name="hash" value={l.hash} />
                            <textarea name="text" defaultValue={l.text} rows={2} className="w-full rounded-md border border-line bg-bg px-2 py-1.5 text-[13px]" />
                            <div className="flex items-start gap-2 sm:flex-col">
                                <span className="text-[12px] text-faint">
                                    {l.installs} user{l.installs === 1 ? '' : 's'} · {l.occurrences}×{l.stack ? ` · ${l.stack}` : ''}
                                </span>
                                <div className="flex gap-2">
                                    <button name="decision" value="approved" className={`${button} text-ok`}>Approve</button>
                                    <button name="decision" value="rejected" className={`${button} text-bad`}>Reject</button>
                                </div>
                            </div>
                        </form>
                    ))}
                    {!pending.length && <p className="text-[13px] text-muted">Nothing waiting.</p>}
                </div>
                {decided.length > 0 && (
                    <details className="mt-3">
                        <summary className="cursor-pointer text-[12.5px] text-muted">Decided lessons ({decided.length})</summary>
                        <ul className="mt-2 grid gap-1 text-[13px]">
                            {decided.map((l) => (
                                <li key={l.hash} className="flex gap-3">
                                    <span className={l.status === 'approved' ? 'text-ok' : 'text-bad'}>{l.status === 'approved' ? 'Shipped' : 'Rejected'}</span>
                                    <span className="flex-1">{l.text}</span>
                                    <form action={lessonAction}>
                                        <input type="hidden" name="hash" value={l.hash} />
                                        <button name="decision" value="pending" className="text-[12px] text-muted hover:text-fg">Undo</button>
                                    </form>
                                </li>
                            ))}
                        </ul>
                    </details>
                )}
            </section>

            <section className="mt-10">
                <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Recurring errors</h2>
                <p className="mb-3 text-[12.5px] text-muted">Errors that came back inside a task, most repeated first. Draft the rule that prevents one, check it, approve it.</p>
                <div className="grid gap-2">
                    {errors.map((e) => (
                        <div key={e.signature} className="rounded-lg border border-line bg-panel p-3">
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                <code className="font-mono text-[12.5px] text-fg">{e.signature}</code>
                                <span className="text-[12px] text-faint">
                                    {e.occurrences}× · repeated {e.repeats}×{e.stack ? ` · ${e.stack}` : ''}
                                </span>
                                {e.status === 'approved' && <span className="text-[12px] text-ok">Rule shipped</span>}
                            </div>
                            <form action={errorAction} className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                                <input type="hidden" name="signature" value={e.signature} />
                                <textarea name="rule" defaultValue={e.draft_rule} rows={2} placeholder="The rule that prevents it" className="w-full rounded-md border border-line bg-bg px-2 py-1.5 text-[13px]" />
                                <div className="flex flex-wrap items-start gap-2">
                                    <button name="decision" value="approved" className={`${button} text-ok`}>Approve rule</button>
                                    <button name="decision" value="save" className={button}>Save</button>
                                    <button name="decision" value="ignored" className={`${button} text-muted`}>Ignore</button>
                                </div>
                            </form>
                            <form action={draftRuleAction} className="mt-1">
                                <input type="hidden" name="signature" value={e.signature} />
                                <input type="hidden" name="tool" value={e.tool} />
                                <input type="hidden" name="stack" value={e.stack} />
                                <button className="text-[12px] text-accent hover:underline">{e.draft_rule ? 'Draft again with a model' : 'Draft a rule with a model'}</button>
                            </form>
                        </div>
                    ))}
                    {!errors.length && <p className="text-[13px] text-muted">None yet.</p>}
                </div>
            </section>

            <section className="mt-10">
                <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Checks the benchmarks keep failing</h2>
                <p className="mb-3 text-[12.5px] text-muted">
                    From the automatic grading of Test lab runs (the nightly run and yours), last 14 days. Draft a rule and it joins the lessons above for approval; the next
                    nightly run shows whether it helped.
                </p>
                <div className="grid gap-2">
                    {failing.map((f) => (
                        <div key={`${f.taskId}:${f.step}`} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line bg-panel p-3">
                            <div className="min-w-0 flex-1">
                                <div className="text-[13px] text-fg">{f.text}</div>
                                <div className="mt-0.5 text-[12px] text-faint">
                                    {f.title} · failed {f.failed} of {f.graded} runs{f.notes.length ? ` · ${f.notes.join(' | ').slice(0, 200)}` : ''}
                                </div>
                            </div>
                            <form action={tuneAction}>
                                <input type="hidden" name="taskId" value={f.taskId} />
                                <input type="hidden" name="step" value={f.step} />
                                <button className="text-[12px] text-accent hover:underline">Draft a rule with a model</button>
                            </form>
                        </div>
                    ))}
                    {!failing.length && <p className="text-[13px] text-muted">Nothing failing twice yet. Runs need automatic checks: the benchmark tasks have them.</p>}
                </div>
            </section>

            <section className="mt-10">
                <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Models, last 14 days</h2>
                <p className="mb-3 text-[12.5px] text-muted">
                    Learned order — complex: {order.deep?.join(' → ') ?? 'not enough tasks yet'} · quick: {order.fast?.join(' → ') ?? 'not enough tasks yet'}
                </p>
                <div className="overflow-x-auto rounded-lg border border-line">
                    <table className="w-full text-[13px] tabular-nums">
                        <thead className="bg-panel text-left text-[11px] uppercase tracking-wide text-muted">
                            <tr>
                                {['Tier', 'Provider', 'Model', 'Tasks', 'Finished', 'Corrected', 'Avg steps', 'Avg tokens', '👍 / 👎'].map((h) => (
                                    <th key={h} className="px-3 py-2">
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {scores
                                .sort((a, b) => b.tasks - a.tasks)
                                .map((s) => (
                                    <tr key={`${s.tier}-${s.provider}-${s.model}`} className="border-t border-line text-muted">
                                        <td className="px-3 py-2">{s.tier === 'deep' ? 'Complex' : 'Quick'}</td>
                                        <td className="px-3 py-2 text-fg">{s.provider}</td>
                                        <td className="px-3 py-2 font-mono text-[12px]">{s.model}</td>
                                        <td className="px-3 py-2">{s.tasks}</td>
                                        <td className="px-3 py-2">{s.tasks ? `${Math.round((s.completed / s.tasks) * 100)}%` : '—'}</td>
                                        <td className="px-3 py-2">{s.tasks ? `${Math.round((s.corrected / s.tasks) * 100)}%` : '—'}</td>
                                        <td className="px-3 py-2">{s.avg_steps}</td>
                                        <td className="px-3 py-2">{Number(s.avg_tokens).toLocaleString('en-US')}</td>
                                        <td className="px-3 py-2">
                                            {s.good} / {s.bad}
                                        </td>
                                    </tr>
                                ))}
                            {!scores.length && (
                                <tr>
                                    <td colSpan={9} className="px-3 py-4 text-muted">
                                        No tasks reported yet.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {rated > 0 && (
                    <p className="mt-3 text-[12.5px] text-muted">
                        Why tasks were rated down:{' '}
                        {REASONS.filter((r) => feedback.reasons[r])
                            .sort((a, b) => (feedback.reasons[b] ?? 0) - (feedback.reasons[a] ?? 0))
                            .map((r) => `${REASON_LABEL[r]} ${feedback.reasons[r]}`)
                            .join(' · ') || 'no reason picked'}
                    </p>
                )}
            </section>

            <section className="mt-10">
                <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Fyx chores</h2>
                <p className="mb-3 text-[12.5px] text-muted">Chores Fyx learned on users&rsquo; machines, with names replaced. Approved ones run with no model for everyone.</p>
                <div className="grid gap-2">
                    {fyx.map((f) => (
                        <form key={f.pattern} action={fyxAction} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2 text-[13px]">
                            <input type="hidden" name="pattern" value={f.pattern} />
                            <span className="text-fg">&ldquo;{f.pattern}&rdquo;</span>
                            <code className="font-mono text-[12px] text-muted">{f.command}</code>
                            <span className="text-[12px] text-faint">
                                {f.installs} user{f.installs === 1 ? '' : 's'}
                            </span>
                            <span className={`ml-auto text-[12px] ${f.status === 'approved' ? 'text-ok' : f.status === 'rejected' ? 'text-bad' : 'text-muted'}`}>{f.status}</span>
                            <button name="decision" value="approved" className={`${button} text-ok`}>Approve</button>
                            <button name="decision" value="rejected" className={`${button} text-bad`}>Reject</button>
                        </form>
                    ))}
                    {!fyx.length && <p className="text-[13px] text-muted">None yet.</p>}
                </div>
            </section>
        </main>
    );
}
