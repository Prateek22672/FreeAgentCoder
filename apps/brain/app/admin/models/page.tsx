import type { Metadata } from 'next';
import { isSignedIn } from '@/lib/admin';
import { kindStats, type KindStats } from '@/lib/learning';
import { readStats } from '@/lib/stats';
import roster from '@/lib/roster.json';

export const metadata: Metadata = { title: 'Models · Admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type Role = (typeof roster)[number];
const DAYS = 14;
const n = (value: number) => Math.round(value).toLocaleString('en-US');

function join(role: Role, kinds: KindStats[]) {
    const own = kinds.filter((k) => role.outcomeKinds.includes(k.kind));
    const tasks = own.reduce((s, k) => s + k.tasks, 0);
    if (!tasks) return undefined;
    const sum = (f: (k: KindStats) => number) => own.reduce((s, k) => s + f(k), 0);
    const models = new Map<string, { name: string; tasks: number; completed: number }>();
    for (const k of own) {
        for (const m of k.byModel) {
            const key = `${m.provider}:${m.model}`;
            const e = models.get(key) ?? { name: key, tasks: 0, completed: 0 };
            e.tasks += m.tasks;
            e.completed += m.completed;
            models.set(key, e);
        }
    }
    return {
        tasks,
        completed: sum((k) => k.completed) / tasks,
        corrected: sum((k) => k.corrected) / tasks,
        paused: sum((k) => k.paused) / tasks,
        steps: sum((k) => k.avgSteps * k.tasks) / tasks,
        tokens: sum((k) => k.avgTokens * k.tasks) / tasks,
        seconds: sum((k) => k.avgSeconds * k.tasks) / tasks,
        models: [...models.values()].sort((a, b) => b.tasks - a.tasks).slice(0, 4),
    };
}

function tone(rate: number | undefined): string {
    return rate === undefined ? 'bg-faint' : rate >= 0.8 ? 'bg-ok' : rate >= 0.5 ? 'bg-[#d29922]' : 'bg-bad';
}

function Effort({ level }: { level: number }) {
    return (
        <span className="inline-flex gap-0.5" aria-label={`Effort ${level} of 3`}>
            {[1, 2, 3].map((i) => (
                <span key={i} className={`h-2 w-4 rounded-sm ${i <= level ? 'bg-accent' : 'bg-line'}`} />
            ))}
        </span>
    );
}

export default async function ModelsPage() {
    if (!(await isSignedIn())) {
        return (
            <main className="mx-auto max-w-xl px-4 py-16 text-fg">
                <p>
                    Sign in on the <a href="/admin" className="text-accent underline">admin page</a> first.
                </p>
            </main>
        );
    }
    const [kinds, stats] = await Promise.all([kindStats(DAYS).catch(() => [] as KindStats[]), readStats(DAYS).catch(() => undefined)]);
    const quick = roster.find((r) => r.id === 'quick')!;
    const build = roster.find((r) => r.id === 'build')!;
    const providers = [...new Set([...quick.chain, ...build.chain].map((l) => l.provider))];
    const fastOf = (p: string) => quick.chain.find((l) => l.provider === p)?.models ?? [];
    const deepOf = (p: string) => build.chain.find((l) => l.provider === p)?.models ?? [];
    const label = (p: string) => quick.chain.find((l) => l.provider === p)?.label ?? build.chain.find((l) => l.provider === p)?.label ?? p;
    const short = (m: string) => m.replace(/^nvidia\//, '').replace(/^openai\//, '').replace(/^z-ai\//, '');

    return (
        <main className="mx-auto w-full max-w-[1500px] px-4 py-8 text-fg">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Models and roles</h1>
                    <p className="mt-1 max-w-3xl text-[14px] text-muted">
                        Which model chain, how much effort, which tools and what context each kind of task gets, with how it is really doing over the last {DAYS} days. Generated
                        from the extension&rsquo;s own routing code, so it cannot drift from what runs.
                    </p>
                </div>
                <nav className="flex gap-4 text-[13px] text-muted">
                    <a href="/admin" className="hover:text-fg">Overview</a>
                    <a href="/admin/system" className="hover:text-fg">System</a>
                    <a href="/admin/learning" className="hover:text-fg">Learning</a>
                </nav>
            </div>

            <section className="mt-6 grid gap-3 sm:grid-cols-4">
                {[
                    ['1. Understand', 'Small talk and questions get a tiny prompt; chores go to Fyx; the rest is quick or complex.'],
                    ['2. Choose the chain', 'Quick work starts on the fastest model, complex work on the strongest, each over your keys in order.'],
                    ['3. Set the effort', 'Reasoning, tools and context are sized to the task: fewer tools and tokens for small work.'],
                    ['4. Escalate and check', 'A repeated error moves to the strongest model; nothing is "done" until the checks pass.'],
                ].map(([title, text]) => (
                    <div key={title} className="rounded-lg border border-line bg-panel p-3">
                        <div className="text-[13px] font-semibold">{title}</div>
                        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{text}</p>
                    </div>
                ))}
            </section>

            <section className="mt-8">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Which model for which task</h2>
                <div className="overflow-x-auto rounded-xl border border-line">
                    <table className="w-full min-w-[980px] text-[13px]">
                        <thead className="bg-panel text-left text-[12px] text-muted">
                            <tr>
                                <th className="px-3 py-2 font-medium">Task type</th>
                                <th className="px-3 py-2 font-medium">First choice</th>
                                <th className="px-3 py-2 font-medium">Effort</th>
                                <th className="px-3 py-2 font-medium">Tools</th>
                                <th className="px-3 py-2 font-medium">Typical tokens</th>
                                <th className="px-3 py-2 font-medium">Last {DAYS} days</th>
                            </tr>
                        </thead>
                        <tbody>
                            {roster.map((role) => {
                                const live = join(role, kinds);
                                const first = role.chain[0];
                                return (
                                    <tr key={role.id} className="border-t border-line align-top">
                                        <td className="px-3 py-2">
                                            <a href={`#${role.id}`} className="font-medium text-fg hover:text-accent">{role.title}</a>
                                            <div className="text-[12px] text-faint">{role.handles[0]}</div>
                                        </td>
                                        <td className="px-3 py-2">
                                            {role.kind === 'no-model' ? <span className="text-muted">No model</span> : first ? <span>{first.label}<span className="block text-[12px] text-faint">{short(first.models[0] ?? '')}</span></span> : '—'}
                                        </td>
                                        <td className="px-3 py-2">
                                            <Effort level={role.effort.level} />
                                            <div className="mt-0.5 text-[12px] text-faint">{role.effort.reasoning}</div>
                                        </td>
                                        <td className="px-3 py-2 tabular-nums">{role.tools.count}</td>
                                        <td className="px-3 py-2 tabular-nums">{role.tokens.typical}</td>
                                        <td className="px-3 py-2">
                                            {live ? (
                                                <span className="inline-flex items-center gap-2">
                                                    <span className={`inline-block h-2 w-2 rounded-full ${tone(live.completed)}`} />
                                                    <span className="tabular-nums">{Math.round(live.completed * 100)}% of {n(live.tasks)}</span>
                                                </span>
                                            ) : role.id === 'fyx' ? (
                                                <span className="tabular-nums text-muted">{n(stats?.totals.fyxTasks ?? 0)} tasks</span>
                                            ) : (
                                                <span className="text-faint">no data yet</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="mt-8">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">The model behind each provider, by tier</h2>
                <div className="overflow-x-auto rounded-xl border border-line">
                    <table className="w-full min-w-[760px] text-[13px]">
                        <thead className="bg-panel text-left text-[12px] text-muted">
                            <tr>
                                <th className="px-3 py-2 font-medium">Provider</th>
                                <th className="px-3 py-2 font-medium">Quick tasks (tried in this order)</th>
                                <th className="px-3 py-2 font-medium">Complex tasks (tried in this order)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {providers.map((p) => (
                                <tr key={p} className="border-t border-line align-top">
                                    <td className="px-3 py-2 font-medium">{label(p)}</td>
                                    <td className="px-3 py-2">{fastOf(p).map((m, i) => <div key={m} className={i ? 'text-muted' : ''}>{i + 1}. {short(m)}</div>)}{!fastOf(p).length ? '—' : null}</td>
                                    <td className="px-3 py-2">{deepOf(p).map((m, i) => <div key={m} className={i ? 'text-muted' : ''}>{i + 1}. {short(m)}</div>)}{!deepOf(p).length ? '—' : null}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p className="mt-2 text-[12px] text-faint">
                    Free limits are per model, so when one model is busy or out of quota the same key carries on with the next before work moves to another provider. The
                    provider order shown on each role is the default; once a provider has 20+ finished tasks the Learning page&rsquo;s learned order is applied on top.
                </p>
            </section>

            <section className="mt-8 grid gap-4 lg:grid-cols-2">
                {roster.map((role) => {
                    const live = join(role, kinds);
                    return (
                        <article id={role.id} key={role.id} className="rounded-xl border border-line bg-panel p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h3 className="text-[15px] font-semibold">{role.title}</h3>
                                    <p className="mt-0.5 text-[13px] text-muted">{role.purpose}</p>
                                </div>
                                <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">
                                    {role.kind === 'no-model' ? 'no model' : role.kind === 'reader' ? 'reader' : 'model chain'}
                                </span>
                            </div>

                            {live ? (
                                <div className="mt-3 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
                                    {[
                                        ['Tasks', n(live.tasks)],
                                        ['Finished', `${Math.round(live.completed * 100)}%`],
                                        ['Corrected', `${Math.round(live.corrected * 100)}%`],
                                        ['Steps', live.steps.toFixed(1)],
                                        ['Tokens', n(live.tokens)],
                                        ['Seconds', n(live.seconds)],
                                    ].map(([k, v]) => (
                                        <div key={k} className="rounded-md border border-line bg-bg px-1 py-1.5">
                                            <div className="text-[10.5px] text-muted">{k}</div>
                                            <div className="text-[13px] font-semibold tabular-nums">{v}</div>
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                            {live?.models.length ? (
                                <p className="mt-2 text-[12px] text-muted">
                                    Answered by: {live.models.map((m) => `${short(m.name)} (${m.tasks}, ${Math.round((m.completed / m.tasks) * 100)}% finished)`).join(' · ')}
                                </p>
                            ) : null}

                            <dl className="mt-3 grid gap-2 text-[13px]">
                                {role.chain.length ? (
                                    <div>
                                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">Model chain, in order</dt>
                                        <dd className="mt-1 flex flex-wrap gap-1.5">
                                            {role.chain.map((l, i) => (
                                                <span key={l.provider} className="rounded-md border border-line bg-bg px-2 py-1 text-[12px]" title={l.models.join(' → ')}>
                                                    <span className="text-faint">{i + 1}.</span> {l.label}
                                                    {l.models[0] ? <span className="text-muted"> · {short(l.models[0])}{l.models.length > 1 ? ` +${l.models.length - 1}` : ''}</span> : null}
                                                </span>
                                            ))}
                                        </dd>
                                        <dd className="mt-1 text-[12px] text-faint">{role.chainNote}</dd>
                                    </div>
                                ) : (
                                    <div>
                                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">Model</dt>
                                        <dd className="text-[12.5px] text-muted">{role.chainNote}</dd>
                                    </div>
                                )}
                                <div>
                                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">Effort</dt>
                                    <dd className="flex flex-wrap items-center gap-2">
                                        <Effort level={role.effort.level} />
                                        <span>{role.effort.reasoning}</span>
                                        <span className="text-faint">· {role.effort.steps}</span>
                                    </dd>
                                    <dd className="text-[12px] text-faint">{role.effort.note}</dd>
                                </div>
                                <div>
                                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">Tools ({role.tools.count})</dt>
                                    <dd className="flex flex-wrap gap-1">
                                        {role.tools.names.map((t) => (
                                            <code key={t} className="rounded bg-bg px-1.5 py-0.5 text-[11.5px] text-muted">{t}</code>
                                        ))}
                                        {!role.tools.names.length ? <span className="text-faint">none</span> : null}
                                    </dd>
                                    <dd className="text-[12px] text-faint">{role.tools.note}</dd>
                                </div>
                                <List title="What it is given" items={role.context} />
                                <List title="How it works" items={role.approach} numbered />
                                <List title="Checks before done" items={role.checks} />
                                <div>
                                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">Typical cost</dt>
                                    <dd>{role.tokens.typical} tokens <span className="text-faint">· {role.tokens.note}</span></dd>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-3">
                                    <Mini title="Strengths" items={role.strengths} dot="bg-ok" />
                                    <Mini title="Weaknesses" items={role.weaknesses} dot="bg-[#d29922]" />
                                    <Mini title="Next" items={role.improvements} dot="bg-accent" />
                                </div>
                            </dl>
                        </article>
                    );
                })}
            </section>
        </main>
    );
}

function List({ title, items, numbered }: { title: string; items: string[]; numbered?: boolean }) {
    if (!items.length) return null;
    return (
        <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</dt>
            <dd>
                <ol className={`mt-1 grid gap-1 ${numbered ? 'list-decimal pl-5' : 'list-disc pl-5'} text-[12.5px] text-fg marker:text-faint`}>
                    {items.map((item) => (
                        <li key={item}>{item}</li>
                    ))}
                </ol>
            </dd>
        </div>
    );
}

function Mini({ title, items, dot }: { title: string; items: string[]; dot: string }) {
    return (
        <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</dt>
            <dd>
                {items.length ? (
                    <ul className="mt-1 grid gap-1 text-[12px]">
                        {items.map((item) => (
                            <li key={item} className="flex gap-1.5">
                                <span className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                                <span>{item}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <span className="text-faint">—</span>
                )}
            </dd>
        </div>
    );
}
