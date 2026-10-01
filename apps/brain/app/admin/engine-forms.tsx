'use client';

import { useActionState } from 'react';
import type { PoolKeyView } from '@/lib/keypool';
import type { SpecialistId, SpecialistSetting } from '@/lib/specialists';
import { addKeyAction, checkKeysAction, removeKeyAction, saveExtTrialAction, saveSpecialistsAction, toggleKeyAction, type FormState } from './engine-actions';
import type { ExtTrialDay, ExtTrialSettings } from '@/lib/extTrial';

const field = 'h-10 w-full rounded-md border border-line-strong bg-panel px-3 text-[14px] text-fg outline-none placeholder:text-faint focus:border-accent';
const label = 'block text-[11px] font-semibold uppercase tracking-wide text-muted';
const saveButton = 'h-10 rounded-md bg-accent px-4 text-[14px] font-semibold text-accent-fg hover:brightness-110 disabled:opacity-60';

function Status({ state, savedText }: { state?: FormState; savedText: string }) {
    if (state?.error) return <span className="text-[13px] text-bad">{state.error}</span>;
    if (state?.saved) return <span className="text-[13px] text-ok">{savedText}</span>;
    return null;
}

function ago(at: number): string {
    const minutes = Math.round((Date.now() - at) / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

const HEALTH_TONE = { ok: 'text-ok', limited: 'text-warn', invalid: 'text-bad', error: 'text-warn' } as const;
const HEALTH_WORD = { ok: 'Working', limited: 'Rate limited', invalid: 'Invalid key', error: 'Could not check' } as const;

export function KeyPool({ keys, providers, needStore }: { keys: PoolKeyView[]; providers: readonly string[]; needStore: boolean }) {
    const [state, action, pending] = useActionState<FormState | undefined, FormData>(addKeyAction, undefined);
    return (
        <div className="col-span-full grid gap-4">
            <p className="rounded-lg border border-warn/30 bg-warn/10 px-4 py-3 text-[13px] leading-relaxed text-warn">
                One key per provider account. Several free accounts used to multiply one provider’s free quota breaks their terms, and those keys get banned
                together. To serve more people, add a paid key.
            </p>
            {needStore && (
                <div className="rounded-lg border border-bad/50 bg-bad/10 px-4 py-3 text-[13px] leading-relaxed text-fg">
                    <p className="font-semibold text-bad">Keys cannot be saved yet: this deployment has no storage.</p>
                    <p className="mt-1 text-muted">
                        Without it, every key is held in one short-lived server&rsquo;s memory and vanishes within minutes. Run{' '}
                        <code className="font-mono">apps/brain/supabase/schema.sql</code> once in your Supabase project&rsquo;s SQL Editor, then set{' '}
                        <code className="font-mono">SUPABASE_URL</code> and <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> in the deployment. Also set{' '}
                        <code className="font-mono">KEY_POOL_SECRET</code> to a long random value, so changing the admin password never makes saved keys unreadable.
                        Redeploy, then add the keys again.
                    </p>
                </div>
            )}
            {keys.length ? (
                <div className="overflow-x-auto rounded-lg border border-line">
                    <table className="w-full text-[13px]">
                        <thead className="bg-panel text-left text-[11px] uppercase tracking-wide text-muted">
                            <tr>
                                <th className="px-3 py-2">Key</th>
                                <th className="px-3 py-2">Status</th>
                                <th className="px-3 py-2">Health</th>
                                <th className="px-3 py-2">Limits</th>
                                <th className="px-3 py-2">Today</th>
                                <th className="px-3 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {keys.map((k) => (
                                <tr key={k.id} className="border-t border-line">
                                    <td className="px-3 py-2">
                                        <span className="text-fg">{k.label}</span> <span className="text-faint">· {k.provider} · …{k.last4}</span>
                                    </td>
                                    <td className="px-3 py-2">
                                        {!k.enabled ? (
                                            <span className="text-faint">Off</span>
                                        ) : k.benched ? (
                                            <span className="text-warn">Resting — failed repeatedly</span>
                                        ) : (
                                            <span className="text-ok">In use</span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2">
                                        {k.health ? (
                                            <span title={k.health.message}>
                                                <span className={HEALTH_TONE[k.health.state]}>{HEALTH_WORD[k.health.state]}</span>{' '}
                                                <span className="text-faint">· {ago(k.health.at)}</span>
                                                {k.health.state !== 'ok' && <span className="block max-w-[280px] truncate text-[11.5px] text-faint">{k.health.message}</span>}
                                            </span>
                                        ) : (
                                            <span className="text-faint">Not checked</span>
                                        )}
                                    </td>
                                    <td className="max-w-[300px] px-3 py-2 text-[12px] leading-snug text-muted">
                                        {k.health?.limits?.length ? (
                                            <>
                                                {k.health.limits.map((line) => (
                                                    <span key={line} className="block text-fg">
                                                        {line}
                                                    </span>
                                                ))}
                                                <span className="block text-faint">as of {ago(k.health.limitsAt ?? k.health.at)}</span>
                                            </>
                                        ) : (
                                            <>
                                                <span className="block">{k.published ?? 'Not published'}</span>
                                                <span className="block text-faint">Press Check for this key&rsquo;s live figures</span>
                                            </>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 tabular-nums text-muted">
                                        {k.today.ok} ok · {k.today.failed} failed
                                    </td>
                                    <td className="flex justify-end gap-2 px-3 py-2">
                                        <form action={checkKeysAction}>
                                            <input type="hidden" name="id" value={k.id} />
                                            <button type="submit" className="rounded-md border border-line px-2.5 py-1 text-[12px] text-muted hover:text-fg">
                                                Check
                                            </button>
                                        </form>
                                        <form action={toggleKeyAction}>
                                            <input type="hidden" name="id" value={k.id} />
                                            <input type="hidden" name="enabled" value={String(!k.enabled)} />
                                            <button type="submit" className="rounded-md border border-line px-2.5 py-1 text-[12px] text-muted hover:text-fg">
                                                {k.enabled ? 'Turn off' : 'Turn on'}
                                            </button>
                                        </form>
                                        <form action={removeKeyAction}>
                                            <input type="hidden" name="id" value={k.id} />
                                            <button type="submit" className="rounded-md border border-line px-2.5 py-1 text-[12px] text-bad hover:border-bad">
                                                Remove
                                            </button>
                                        </form>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <form action={checkKeysAction} className="flex justify-end border-t border-line px-3 py-2">
                        <button type="submit" className="rounded-md border border-line px-3 py-1 text-[12px] text-muted hover:text-fg">
                            Check all keys now (one test request each)
                        </button>
                    </form>
                </div>
            ) : (
                <p className="text-[13px] text-muted">No keys in the pool yet. The trial uses only keys set in the environment.</p>
            )}
            <form action={action} className="grid gap-3 rounded-lg border border-line bg-panel p-4 sm:grid-cols-[160px_1fr_2fr_auto] sm:items-end">
                <div>
                    <span className={label}>Provider</span>
                    <select name="provider" className={`${field} mt-1`} defaultValue="gemini">
                        {providers.map((p) => (
                            <option key={p} value={p}>
                                {p}
                            </option>
                        ))}
                    </select>
                </div>
                <div>
                    <span className={label}>Label</span>
                    <input name="label" placeholder="Main Gemini" maxLength={40} className={`${field} mt-1`} />
                </div>
                <div>
                    <span className={label}>API key</span>
                    <input name="key" type="password" autoComplete="off" placeholder="Paste the key — it is encrypted before it is stored" className={`${field} mt-1`} />
                </div>
                <button type="submit" disabled={pending} className={saveButton}>
                    {pending ? 'Adding…' : 'Add key'}
                </button>
                <div className="sm:col-span-4">
                    <Status state={state} savedText="Added. The trial starts using it within a minute." />
                </div>
            </form>
        </div>
    );
}

export function SpecialistsForm({
    info,
    settings,
    stats,
}: {
    info: readonly { id: SpecialistId; name: string; about: string }[];
    settings: Record<SpecialistId, SpecialistSetting>;
    stats: Record<string, { tasks: number; failed: number }>;
}) {
    const [state, action, pending] = useActionState<FormState | undefined, FormData>(saveSpecialistsAction, undefined);
    return (
        <form action={action} className="col-span-full grid gap-3">
            {info.map((s) => {
                const setting = settings[s.id];
                const row = stats[s.id];
                const rate = row?.tasks ? Math.round((row.failed / row.tasks) * 100) : undefined;
                return (
                    <div key={s.id} className="grid gap-3 rounded-lg border border-line bg-panel p-4 lg:grid-cols-[220px_1fr_1fr]">
                        <label className="flex items-start gap-3">
                            <input type="checkbox" name={`${s.id}.enabled`} defaultChecked={setting.enabled} className="mt-1 size-4 accent-[var(--accent)]" />
                            <span>
                                <span className="block text-[14px] font-medium text-fg">{s.name}</span>
                                <span className="block text-[12px] text-muted">{s.about}</span>
                                <span className="mt-1 block text-[12px] tabular-nums text-faint">
                                    {row?.tasks ? `${row.tasks} tasks · ${rate}% failed` : 'No reports yet'}
                                </span>
                            </span>
                        </label>
                        <div>
                            <span className={label}>Preferred model (optional)</span>
                            <input name={`${s.id}.model`} defaultValue={setting.model} placeholder="gemini:gemini-3.8-flash" className={`${field} mt-1`} />
                        </div>
                        <div>
                            <span className={label}>Extra instructions (optional)</span>
                            <textarea
                                name={`${s.id}.extra`}
                                defaultValue={setting.extra}
                                maxLength={1500}
                                rows={2}
                                placeholder="Added to this specialist’s method in every user’s extension."
                                className="mt-1 w-full rounded-md border border-line-strong bg-panel px-3 py-2 text-[13px] text-fg outline-none placeholder:text-faint focus:border-accent"
                            />
                        </div>
                    </div>
                );
            })}
            <div className="flex items-center gap-3">
                <button type="submit" disabled={pending} className={saveButton}>
                    {pending ? 'Saving…' : 'Save specialists'}
                </button>
                <Status state={state} savedText="Saved. Extensions pick it up within a day." />
            </div>
        </form>
    );
}

const n = (value: number) => value.toLocaleString('en-US');

/** The extension's free trial: is it reaching people, how much it costs the pool, and its limits. */
export function ExtTrial({ settings, days, poolKeys }: { settings: ExtTrialSettings; days: ExtTrialDay[]; poolKeys: number }) {
    const [state, action, pending] = useActionState<FormState | undefined, FormData>(saveExtTrialAction, undefined);
    const day = days[0];
    const week = days.reduce((sum, d) => ({ requests: sum.requests + d.requests, newInstalls: sum.newInstalls + d.newInstalls }), { requests: 0, newInstalls: 0 });
    const served = day ? day.requests : 0;
    const refused = day ? day.refusedLimit + day.refusedClosed + day.refusedOff : 0;
    const status = !settings.enabled
        ? { tone: 'text-faint', text: 'Off: extension users without a key are told to add one.' }
        : !poolKeys
          ? { tone: 'text-bad', text: 'On, but the key pool has no working key, so no one can use it. Add or check keys above.' }
          : day && day.failed > served && day.failed > 3
            ? { tone: 'text-warn', text: 'On, but most requests failed today. Check the key health above.' }
            : served
              ? { tone: 'text-ok', text: `Working: ${n(day!.installs)} people used it today.` }
              : { tone: 'text-muted', text: 'On and ready. No one has used it yet today.' };
    const capShare = settings.dailyCap ? Math.min(100, Math.round((served / settings.dailyCap) * 100)) : 0;
    const tiles: [string, string, string][] = [
        ['People today', day ? n(day.installs) : '0', day ? `${n(day.newInstalls)} new` : ''],
        ['Requests today', n(served), `${capShare}% of the ${n(settings.dailyCap)} daily cap`],
        ['Tokens today', day ? n(day.tokens) : '0', 'Prompts and replies'],
        ['Hit their limit', day ? n(day.reachedLimit) : '0', 'People today'],
        ['Turned away', n(refused), day ? `${n(day.refusedClosed)} by the daily cap` : ''],
        ['Last 7 days', n(week.requests), `${n(week.newInstalls)} new people`],
    ];
    const limits: [keyof ExtTrialSettings, string, number, string][] = [
        ['requestsPerInstall', 'Requests per person, a day', settings.requestsPerInstall, 'A task is usually 8 to 15'],
        ['tokensPerInstall', 'Tokens per person, a day', settings.tokensPerInstall, 'Stops one huge project draining it'],
        ['requestsPerAddress', 'Requests per network, a day', settings.requestsPerAddress, 'Stops resets by reinstalling'],
        ['dailyCap', 'Requests for everyone, a day', settings.dailyCap, 'Keep it under the pool\u2019s free quota'],
    ];
    return (
        <div className="col-span-full grid gap-4">
            <p className={`rounded-lg border border-line bg-panel px-4 py-3 text-[13.5px] ${status.tone}`}>{status.text}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {tiles.map(([title, value, hint]) => (
                    <div key={title} className="rounded-lg border border-line bg-panel p-3">
                        <div className="text-[11px] uppercase tracking-wide text-muted">{title}</div>
                        <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
                        {hint ? <div className="mt-0.5 text-[11px] text-muted">{hint}</div> : null}
                    </div>
                ))}
            </div>
            <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-[13px] tabular-nums">
                    <thead className="bg-panel text-left text-[11px] uppercase tracking-wide text-muted">
                        <tr>
                            {['Day', 'People', 'New', 'Requests', 'Tokens', 'Hit limit', 'Turned away', 'Failed', 'Served by'].map((h) => (
                                <th key={h} className="px-3 py-2">
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {days.map((d) => (
                            <tr key={d.day} className="border-t border-line text-muted">
                                <td className="px-3 py-2 text-fg">{d.day}</td>
                                <td className="px-3 py-2">{n(d.installs)}</td>
                                <td className="px-3 py-2">{n(d.newInstalls)}</td>
                                <td className="px-3 py-2">{n(d.requests)}</td>
                                <td className="px-3 py-2">{n(d.tokens)}</td>
                                <td className="px-3 py-2">{n(d.reachedLimit)}</td>
                                <td className="px-3 py-2">{n(d.refusedLimit + d.refusedClosed + d.refusedOff)}</td>
                                <td className="px-3 py-2">{n(d.failed)}</td>
                                <td className="px-3 py-2">
                                    {Object.entries(d.providers)
                                        .sort((a, b) => b[1] - a[1])
                                        .map(([p, c]) => `${p} ${n(c)}`)
                                        .join(' \u00b7 ') || '\u2014'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <form action={action} className="grid gap-3 rounded-lg border border-line bg-panel p-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
                <label className="flex items-center gap-2 text-[14px] text-fg sm:col-span-2 lg:col-span-5">
                    <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="size-4 accent-[var(--accent)]" />
                    Offer the free trial to extension users who have no key
                </label>
                {limits.map(([name, title, value, hint]) => (
                    <div key={name}>
                        <span className={label}>{title}</span>
                        <input name={name} type="number" min={0} defaultValue={value} className={`${field} mt-1`} />
                        <span className="mt-1 block text-[11px] text-faint">{hint}</span>
                    </div>
                ))}
                <div className="flex items-center gap-3">
                    <button type="submit" disabled={pending} className={saveButton}>
                        {pending ? 'Saving\u2026' : 'Save limits'}
                    </button>
                    <Status state={state} savedText="Saved." />
                </div>
            </form>
        </div>
    );
}
