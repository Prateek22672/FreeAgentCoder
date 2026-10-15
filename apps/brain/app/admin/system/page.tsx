import type { Metadata } from 'next';
import { isSignedIn } from '@/lib/admin';
import { recentEvents } from '@/lib/events';
import { extTrialStats, readExtTrialSettings } from '@/lib/extTrial';
import { listPool } from '@/lib/keypool';
import { failingSteps, listResults, readTasks } from '@/lib/lab';
import { feedbackSummary, learningAvailable, listErrors, listLessons, modelScores, type ErrorRow, type LessonRow, type ModelScore } from '@/lib/learning';
import { marketplaceStats } from '@/lib/marketplace';
import { readScore } from '@/lib/score';
import { readStats } from '@/lib/stats';
import { buildSystem, GROUPS, overall, type Health } from '@/lib/system';
import { SystemFlow } from './flow';

export const metadata: Metadata = { title: 'System · Admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const DAYS = 14;
const n = (value: number) => value.toLocaleString('en-US');
const TONE: Record<Health, string> = { ok: 'text-ok', warn: 'text-[#d29922]', down: 'text-bad', idle: 'text-muted' };
const SAY: Record<Health, string> = { ok: 'All systems healthy', warn: 'Some parts need attention', down: 'Something is down', idle: 'Waiting for data' };

/**
 * The whole system on one page: a live workflow of every part with its
 * health, then the trends, the failure causes, the models and the event log.
 */
export default async function SystemPage() {
    if (!(await isSignedIn())) {
        return (
            <main className="mx-auto max-w-xl px-4 py-16 text-fg">
                <p>
                    Sign in on the <a href="/admin" className="text-accent underline">admin page</a> first.
                </p>
            </main>
        );
    }
    const safe = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
    const [market, stats, score, trialDays, trialSettings, pool, models, feedback, lessons, errors, labTasks, labResults, events] = await Promise.all([
        safe(marketplaceStats(), undefined),
        readStats(DAYS),
        readScore(DAYS),
        safe(extTrialStats(1), []),
        readExtTrialSettings(),
        safe(listPool(), []),
        safe(modelScores(DAYS), [] as ModelScore[]),
        safe(feedbackSummary(DAYS), { good: 0, bad: 0, reasons: {} as Record<string, number> }),
        safe(listLessons(), [] as LessonRow[]),
        safe(listErrors(), [] as ErrorRow[]),
        safe(readTasks(), []),
        safe(listResults(), []),
        safe(recentEvents(3), []),
    ]);
    const since = Date.now() - DAYS * 86_400_000;
    const recentRuns = labResults.filter((r) => r.at >= since && r.auto);
    const graded = recentRuns.reduce((s, r) => s + r.auto!.graded.length, 0);
    const passed = recentRuns.reduce((s, r) => s + r.auto!.passed.length, 0);
    const today = trialDays[0];
    const { nodes, edges } = buildSystem({
        installs: market?.installs,
        active: stats.active,
        versions: stats.versions,
        totals: stats.totals,
        daily: stats.daily,
        failures: stats.failures,
        providerInstalls: stats.providers,
        score,
        trial: {
            enabled: trialSettings.enabled,
            requests: today?.requests ?? 0,
            installs: today?.installs ?? 0,
            refused: (today?.refusedLimit ?? 0) + (today?.refusedClosed ?? 0),
            failed: today?.failed ?? 0,
            tokens: today?.tokens ?? 0,
            cap: trialSettings.dailyCap,
            bonusTokens: trialSettings.bonusTokens,
            bonuses: today?.bonuses ?? 0,
        },
        pool: pool.map((k) => ({ provider: k.provider, enabled: k.enabled, benched: k.benched, state: k.health?.state, okToday: k.today.ok, failedToday: k.today.failed })),
        models,
        feedback,
        lessons: { pending: lessons.filter((l) => l.status === 'pending').length, approved: lessons.filter((l) => l.status === 'approved').length },
        errors,
        lab: {
            runs: recentRuns.length,
            lastAt: recentRuns[0]?.at,
            passRate: graded ? passed / graded : undefined,
            failing: failingSteps(labTasks, labResults, DAYS),
        },
        events,
        learningAvailable,
    });
    const state = overall(nodes);
    const days = [...stats.daily].reverse().slice(-DAYS);
    const peak = Math.max(1, ...days.map((d) => d.tasks));

    return (
        <main className="mx-auto w-full max-w-[1640px] px-4 py-8 text-fg">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">System</h1>
                    <p className={`mt-1 text-[14px] font-medium ${TONE[state]}`}>{SAY[state]}</p>
                </div>
                <nav className="flex gap-4 text-[13px] text-muted">
                    <a href="/admin" className="hover:text-fg">Overview</a>
                    <a href="/admin/learning" className="hover:text-fg">Learning</a>
                    <a href="/admin/lab" className="hover:text-fg">Test lab</a>
                    <a href="/admin/references" className="hover:text-fg">References</a>
                    <a href="/admin/roadmap" className="hover:text-fg">Roadmap</a>
                </nav>
            </div>

            <section className="mt-5">
                <SystemFlow nodes={nodes} edges={edges} groups={GROUPS} updatedAt={Date.now()} />
                <p className="mt-2 text-[12px] text-faint">Click any step for its numbers, recent problems, how it works, its strengths and weaknesses, and what comes next. Counts come from installs that chose to share; the trial and pool are this site’s own.</p>
            </section>

            <section className="mt-10 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
                <div className="rounded-xl border border-line bg-panel p-4">
                    <h2 className="text-[13px] font-semibold">Tasks, last {DAYS} days</h2>
                    <p className="text-[12px] text-muted">Finished and failed each day, from installs that share counts.</p>
                    {days.some((d) => d.tasks) ? (
                        <svg viewBox={`0 0 ${days.length * 40} 150`} className="mt-3 h-44 w-full" role="img" aria-label="Tasks per day">
                            {days.map((d, i) => {
                                const doneH = (d.done / peak) * 120;
                                const failH = (d.failed / peak) * 120;
                                return (
                                    <g key={d.day}>
                                        <title>{`${d.day}: ${d.done} finished, ${d.failed} failed, ${d.tasks} tasks`}</title>
                                        <rect x={i * 40 + 8} y={130 - doneH - failH} width="24" height={failH} rx="3" fill="#f85149" fillOpacity="0.85" />
                                        <rect x={i * 40 + 8} y={130 - doneH} width="24" height={doneH} rx="3" fill="#3fb950" fillOpacity="0.85" />
                                        <text x={i * 40 + 20} y="146" textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.55">
                                            {d.day.slice(8)}
                                        </text>
                                    </g>
                                );
                            })}
                        </svg>
                    ) : (
                        <p className="mt-6 text-[13px] text-faint">No task counts yet: they arrive from installs on 0.6.1 that chose OK.</p>
                    )}
                    <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {[
                            ['Quality score', score.score === null ? '—' : String(score.score)],
                            ['Tokens a task', score.tokensPerTask === null ? '—' : n(Math.round(score.tokensPerTask))],
                            ['Active this week', n(stats.active.week)],
                            ['Done by Fyx', n(stats.totals.fyxTasks ?? 0)],
                        ].map(([label, value]) => (
                            <div key={label} className="rounded-lg border border-line bg-bg p-2.5">
                                <div className="text-[11px] text-muted">{label}</div>
                                <div className="text-lg font-semibold tabular-nums">{value}</div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="rounded-xl border border-line bg-panel p-4">
                    <h2 className="text-[13px] font-semibold">What stops tasks</h2>
                    <p className="text-[12px] text-muted">Causes reported over {DAYS} days, most first.</p>
                    <ul className="mt-3 grid gap-1.5 text-[13px]">
                        {stats.failures.slice(0, 10).map((f) => (
                            <li key={f.cause} className="flex items-center gap-2">
                                <span className="w-44 truncate font-mono text-[12px] text-fg">{f.cause}</span>
                                <span className="h-2 flex-1 rounded bg-bg">
                                    <span className="block h-2 rounded bg-bad/70" style={{ width: `${Math.max(4, (f.times / Math.max(1, stats.failures[0]!.times)) * 100)}%` }} />
                                </span>
                                <span className="w-10 text-right tabular-nums text-muted">{f.times}</span>
                            </li>
                        ))}
                        {!stats.failures.length ? <li className="text-faint">Nothing reported.</li> : null}
                    </ul>
                </div>
            </section>

            <section className="mt-6 grid gap-6 lg:grid-cols-2">
                <div className="rounded-xl border border-line bg-panel p-4">
                    <h2 className="text-[13px] font-semibold">Models, by real outcomes</h2>
                    <table className="mt-3 w-full text-[12.5px] tabular-nums">
                        <thead className="text-left text-muted">
                            <tr>
                                <th className="pb-1 font-medium">Model</th>
                                <th className="pb-1 font-medium">Tier</th>
                                <th className="pb-1 text-right font-medium">Tasks</th>
                                <th className="pb-1 text-right font-medium">Finished</th>
                                <th className="pb-1 text-right font-medium">Avg tokens</th>
                            </tr>
                        </thead>
                        <tbody>
                            {[...models].sort((a, b) => b.tasks - a.tasks).slice(0, 12).map((m) => (
                                <tr key={`${m.tier}-${m.provider}-${m.model}`} className="border-t border-line/60">
                                    <td className="py-1 pr-2">{m.provider}:{m.model}</td>
                                    <td>{m.tier}</td>
                                    <td className="text-right">{m.tasks}</td>
                                    <td className="text-right">{m.tasks ? `${Math.round((m.completed / m.tasks) * 100)}%` : '—'}</td>
                                    <td className="text-right">{n(Math.round(m.avg_tokens))}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {!models.length ? <p className="mt-2 text-[13px] text-faint">No outcomes yet.</p> : null}
                </div>

                <div className="rounded-xl border border-line bg-panel p-4">
                    <h2 className="text-[13px] font-semibold">Event log</h2>
                    <p className="text-[12px] text-muted">The last 3 days: model failures for the trial, keys put to rest, and more. Keys are masked.</p>
                    <ul className="mt-3 max-h-80 overflow-y-auto text-[12.5px]">
                        {events.slice(0, 120).map((e) => (
                            <li key={`${e.at}-${e.source}-${e.message.slice(0, 20)}`} className="flex gap-2 border-t border-line/60 py-1">
                                <span className="w-24 shrink-0 tabular-nums text-faint">{new Date(e.at).toISOString().slice(5, 16).replace('T', ' ')}</span>
                                <span className={`w-20 shrink-0 ${e.level === 'error' ? 'text-bad' : e.level === 'warn' ? 'text-[#d29922]' : 'text-muted'}`}>{e.source}</span>
                                <span className="min-w-0 break-words text-fg">{e.message}</span>
                            </li>
                        ))}
                        {!events.length ? <li className="text-faint">No events recorded yet.</li> : null}
                    </ul>
                </div>
            </section>
        </main>
    );
}
