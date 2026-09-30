import type { Metadata } from 'next';
import { adminPassword, isSignedIn } from '@/lib/admin';
import { configuredProviders, providerLabel } from '@/lib/ai';
import { readKeyLinks } from '@/lib/keylinks';
import { readPlans } from '@/lib/plans';
import { checkPoolKeys, listPool, POOL_PROVIDERS } from '@/lib/keypool';
import { readSpecialists, SPECIALIST_INFO } from '@/lib/specialists';
import { kvConfigured, settingsNeedStore } from '@/lib/kv';
import { marketplaceStats } from '@/lib/marketplace';
import { readStats, type Stats } from '@/lib/stats';
import { trialUsage } from '@/lib/trial';
import { signOutAction } from './actions';
import { Login } from './login';
import { PlansForm } from './plans-form';
import { KeyPool, SpecialistsForm } from './engine-forms';

export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * The numbers behind the product, in one page: how many people use the
 * extension, how many keys they have and from which providers, what stops
 * their tasks, and whether this site's own keys are close to their limits.
 *
 * Asks for ADMIN_PASSWORD and remembers the answer in a signed cookie.
 * Everything shown is a count: no code, no prompts, no keys.
 */
export default async function AdminPage() {
    if (!(await isSignedIn())) {
        return (
            <Shell>
                <Login configured={!!adminPassword()} />
            </Shell>
        );
    }

    // Keys not checked in the last half hour are checked with their providers
    // now (a few seconds at most), so the health column is never stale.
    await checkPoolKeys().catch(() => undefined);
    const [market, stats, keyLinks, plans, pool, specialists] = await Promise.all([
        marketplaceStats(),
        readStats(),
        readKeyLinks(),
        readPlans(),
        listPool(),
        readSpecialists(),
    ]);
    const trial = trialUsage();
    const ownKeys = configuredProviders();
    const reporting = stats.active.month;
    const share = market?.installs ? Math.round((reporting / market.installs) * 100) : 0;

    return (
        <Shell>
            <div className="flex items-start justify-between gap-4">
                <h1 className="text-2xl font-semibold tracking-tight">FreeAgentCoder</h1>
                <form action={signOutAction}>
                    <button type="submit" className="rounded-md border border-line px-3 py-1.5 text-[13px] text-muted hover:border-accent hover:text-fg">
                        Sign out
                    </button>
                </form>
            </div>
            <p className="mt-1 text-sm text-muted">
                Marketplace numbers cover everyone. The rest comes only from installs whose owner agreed to send anonymous counts
                {reporting > 0 && market?.installs ? `, about ${share}% of them` : ''}
                {reporting === 0 ? ' — none yet, which is expected until a version with counting in it is published.' : '.'}
            </p>

            <Section title="People">
                <Stat label="Installs" value={market ? format(market.installs) : '—'} hint="Marketplace, all time" />
                <Stat label="Downloads" value={market ? format(market.downloads) : '—'} hint="Installs plus updates" />
                <Stat label="Rating" value={market?.ratings ? `${market.rating.toFixed(1)}★` : '—'} hint={market ? `${format(market.ratings)} ratings` : ''} />
                <Stat label="Active, 30 days" value={format(stats.active.month)} hint="Installs that reported" />
                <Stat label="Active, 7 days" value={format(stats.active.week)} />
                <Stat label="Active today" value={format(stats.active.today)} />
            </Section>

            <Section title="Did they get as far as a key?">
                <Stat label="Key links clicked" value={format(keyLinks.total)} hint="Last 30 days" />
                <Stat label="From the extension" value={format(keyLinks.fromExtension)} hint="People setting up" />
                <Stat label="From the website" value={format(keyLinks.fromWeb)} />
                {keyLinks.byProvider.map((row) => (
                    <Stat key={row.provider} label={providerLabel(row.provider)} value={format(row.clicks)} />
                ))}
                {keyLinks.total === 0 ? <Empty>Nobody has clicked a key link yet, or the version with these links is not published.</Empty> : null}
            </Section>

            <Section title="Keys people have">
                {stats.keyHistogram.length ? (
                    <div className="col-span-full grid gap-2">
                        {stats.keyHistogram.map((row) => (
                            <Bar
                                key={row.keys}
                                label={`${row.keys} ${row.keys === 1 ? 'key' : 'keys'}`}
                                value={row.installs}
                                total={stats.reportingInstalls}
                                suffix={`${row.installs} ${row.installs === 1 ? 'install' : 'installs'}`}
                            />
                        ))}
                    </div>
                ) : (
                    <Empty>No reports yet.</Empty>
                )}
            </Section>

            <Section title="Providers people use">
                {stats.providers.length ? (
                    <div className="col-span-full grid gap-2">
                        {stats.providers.map((row) => (
                            <Bar key={row.provider} label={providerLabel(row.provider)} value={row.installs} total={stats.reportingInstalls} suffix={`${row.installs}`} />
                        ))}
                    </div>
                ) : (
                    <Empty>No reports yet.</Empty>
                )}
            </Section>

            <Section title="What stops tasks">
                {stats.failures.length ? (
                    <div className="col-span-full grid gap-2">
                        {stats.failures.map((row) => (
                            <Bar key={row.cause} label={row.cause} value={row.times} total={stats.failures[0]?.times ?? 1} suffix={`${format(row.times)} times`} />
                        ))}
                    </div>
                ) : (
                    <Empty>Nothing reported in the last 30 days.</Empty>
                )}
            </Section>

            <Section title="Tasks, last 30 days">
                <Stat label="Tasks" value={format(stats.totals.tasks ?? 0)} />
                <Stat label="Finished" value={format(stats.totals.done ?? 0)} hint={percent(stats.totals.done, stats.totals.tasks)} />
                <Stat label="Failed" value={format(stats.totals.failed ?? 0)} hint={percent(stats.totals.failed, stats.totals.tasks)} />
                <Stat label="Stopped by hand" value={format(stats.totals.stopped ?? 0)} />
                <Stat label="Images read locally" value={format(stats.totals.readLocally ?? 0)} hint="No API request" />
                <Stat label="Images sent to a model" value={format(stats.totals.readByModel ?? 0)} />
            </Section>

            <section className="mt-8 rounded-lg border border-line bg-panel p-4">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">How the engine runs</h2>
                <ol className="grid gap-2 text-[13.5px] leading-relaxed text-muted">
                    <li>
                        <span className="text-fg">In the extension:</span> each task is classified — quick or complex — then matched to a specialist (the method)
                        and a playbook for its stack (the checks). It runs on the user&rsquo;s own keys, moving to the next key when one hits a limit.
                        {' '}
                        {SPECIALIST_INFO.filter((i) => specialists[i.id].enabled).length} of {SPECIALIST_INFO.length} specialists are on
                        {SPECIALIST_INFO.some((i) => specialists[i.id].model) ? `; preferred models set for ${SPECIALIST_INFO.filter((i) => specialists[i.id].model).map((i) => i.name).join(', ')}` : ''}.
                    </li>
                    <li>
                        <span className="text-fg">On this site:</span> Ask and the Playground use the visitor&rsquo;s own key when they have one; otherwise a free
                        request, tried in this order —{' '}
                        {pool.filter((k) => k.enabled && !k.benched).length || configuredProviders().length
                            ? [
                                  ...pool.filter((k) => k.enabled && !k.benched).map((k) => `${k.label} (pool)`),
                                  ...configuredProviders().map((p) => `${providerLabel(p)} (environment)`),
                              ].join(' → ')
                            : 'no keys yet, so the free trial is off'}
                        .
                    </li>
                    <li>
                        <span className="text-fg">Running code:</span> never on this server. Run and the Playground boot a Node runtime inside the visitor&rsquo;s own
                        browser tab.
                    </li>
                </ol>
            </section>

            <Section title="Specialists — how each kind of work is done">
                <SpecialistsForm info={SPECIALIST_INFO} settings={specialists} stats={stats.bySpecialist} />
            </Section>

            <Section title="Key pool — the site’s free trial">
                <KeyPool keys={pool} providers={POOL_PROVIDERS} needStore={settingsNeedStore} />
            </Section>

            <Section title="Paid tier">
                <PlansForm plans={plans} />
            </Section>

            <Section title="This site's keys">
                <Stat label="Keys here" value={String(ownKeys.length)} hint={ownKeys.map(providerLabel).join(', ') || 'none configured'} />
                <Stat label="Trial questions today" value={`${trial.used} / ${trial.cap}`} hint={`${trial.perVisitor} per visitor`} />
                <Stat label="Visitors who tried" value={format(trial.visitors)} hint="Today" />
            </Section>

            <Section title="Versions">
                {stats.versions.map((row) => (
                    <Stat key={row.version} label={row.version} value={format(row.installs)} />
                ))}
                {stats.platforms.map((row) => (
                    <Stat key={row.platform} label={row.platform} value={format(row.installs)} />
                ))}
            </Section>

            <Recent daily={stats.daily} />

            {!kvConfigured && (
                <Note>
                    Counts are being held in this server's memory, so they reset on every deployment and each instance counts separately. Set{' '}
                    <code className="font-mono text-fg">KV_REST_API_URL</code> and <code className="font-mono text-fg">KV_REST_API_TOKEN</code> to keep them.
                </Note>
            )}
            <p className="mt-6 text-xs text-muted">
                Trial usage is counted in this server's memory and resets when it restarts. Marketplace figures are Microsoft's, cached for an hour.
            </p>
        </Shell>
    );
}

function Shell({ children }: { children: React.ReactNode }) {
    return <main className="mx-auto w-full max-w-5xl px-4 py-10">{children}</main>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="mt-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{children}</div>
        </section>
    );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="rounded-lg border border-line bg-panel p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
            {hint ? <div className="mt-0.5 text-[11px] text-muted">{hint}</div> : null}
        </div>
    );
}

function Bar({ label, value, total, suffix }: { label: string; value: number; total: number; suffix: string }) {
    const width = total > 0 ? Math.max(2, Math.round((value / total) * 100)) : 0;
    return (
        <div className="flex items-center gap-3 text-sm">
            <span className="w-48 shrink-0 truncate font-mono text-xs text-muted" title={label}>
                {label}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded bg-panel-2">
                <span className="block h-full rounded bg-accent" style={{ width: `${width}%` }} />
            </span>
            <span className="w-28 shrink-0 text-right text-xs tabular-nums text-muted">{suffix}</span>
        </div>
    );
}

function Recent({ daily }: { daily: Stats['daily'] }) {
    const peak = Math.max(1, ...daily.map((day) => day.tasks));
    return (
        <section className="mt-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Tasks a day, last 14 days</h2>
            <div className="flex h-28 items-end gap-1 rounded-lg border border-line bg-panel p-3">
                {daily.map((day) => (
                    <div key={day.day} className="flex-1" title={`${day.day}: ${day.tasks} tasks, ${day.failed} failed`}>
                        <div className="w-full rounded-t bg-accent" style={{ height: `${Math.round((day.tasks / peak) * 80)}px` }} />
                    </div>
                ))}
            </div>
        </section>
    );
}

function Note({ children }: { children: React.ReactNode }) {
    return <p className="mt-6 rounded-lg border border-line bg-panel p-4 text-sm text-muted">{children}</p>;
}

function Empty({ children }: { children: React.ReactNode }) {
    return <p className="col-span-full text-sm text-muted">{children}</p>;
}

function format(value: number): string {
    return value.toLocaleString('en-US');
}

function percent(part: number | undefined, whole: number | undefined): string {
    if (!part || !whole) return '';
    return `${Math.round((part / whole) * 100)}% of tasks`;
}
