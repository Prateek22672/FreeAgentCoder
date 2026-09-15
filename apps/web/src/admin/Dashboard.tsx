import { AlertTriangle, ArrowRight } from 'lucide-react';
import { useMemo } from 'react';
import { Card, fmtMs, fmtTime, fmtTokens, Stat } from '../components/ui';
import type { RunRecord } from '../lib/db';
import { modelChain, useSettings } from '../lib/settings';
import { ISSUE_HINTS, providerOf, useRuns } from '../lib/useRuns';
import { BarList, Columns, type BarDatum } from './charts';
import { StatusBadge } from './StatusBadge';

function stats(runs: RunRecord[]) {
  const finished = runs.filter((r) => r.reason !== 'running');
  const ok = finished.filter((r) => r.reason === 'completed').length;
  const calls = runs.flatMap((r) => r.calls);
  const tools = runs.flatMap((r) => r.tools);

  const byProvider = new Map<string, { calls: number; ok: number; ms: number; tokens: number }>();
  for (const c of calls) {
    const p = providerOf(c.ref);
    const s = byProvider.get(p) ?? { calls: 0, ok: 0, ms: 0, tokens: 0 };
    s.calls++;
    if (c.ok) {
      s.ok++;
      s.ms += c.ms;
    }
    s.tokens += (c.inputTokens ?? 0) + (c.outputTokens ?? 0);
    byProvider.set(p, s);
  }

  const errorKinds = new Map<string, number>();
  for (const c of calls) if (!c.ok && c.errorKind) errorKinds.set(c.errorKind, (errorKinds.get(c.errorKind) ?? 0) + 1);

  const toolCounts = new Map<string, { n: number; failed: number }>();
  for (const t of tools) {
    const s = toolCounts.get(t.name) ?? { n: 0, failed: 0 };
    s.n++;
    if (!t.ok) s.failed++;
    toolCounts.set(t.name, s);
  }

  const days: { label: string; value: number; failed: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const next = d.getTime() + 86_400_000;
    const inDay = runs.filter((r) => r.startedAt >= d.getTime() && r.startedAt < next);
    days.push({
      label: d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
      value: inDay.length,
      failed: inDay.filter((r) => r.reason === 'error').length,
    });
  }

  return {
    total: runs.length,
    successRate: finished.length ? Math.round((ok / finished.length) * 100) : null,
    tokensIn: runs.reduce((n, r) => n + r.inputTokens, 0),
    tokensOut: runs.reduce((n, r) => n + r.outputTokens, 0),
    avgMs: finished.length ? finished.reduce((n, r) => n + r.ms, 0) / finished.length : 0,
    calls: calls.length,
    failovers: calls.filter((c) => !c.ok).length,
    toolCalls: tools.length,
    byProvider,
    errorKinds,
    toolCounts,
    days,
  };
}

export function Dashboard({ go }: { go: (page: string) => void }) {
  const runs = useRuns();
  const settings = useSettings();
  const s = useMemo(() => stats(runs), [runs]);
  const chain = modelChain(settings);

  const providerSuccess: BarDatum[] = [...s.byProvider]
    .sort((a, b) => b[1].calls - a[1].calls)
    .map(([p, v]) => ({ label: p, value: Math.round((v.ok / v.calls) * 100), display: `${Math.round((v.ok / v.calls) * 100)}% · ${v.calls} calls` }));
  const providerLatency: BarDatum[] = [...s.byProvider]
    .filter(([, v]) => v.ok)
    .map(([p, v]) => ({ label: p, value: v.ms / v.ok, display: fmtMs(v.ms / v.ok) }))
    .sort((a, b) => a.value - b.value);
  const errors: BarDatum[] = [...s.errorKinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ label: k.replace('_', ' '), value: n, tooltip: ISSUE_HINTS[k] }));
  const tools: BarDatum[] = [...s.toolCounts]
    .sort((a, b) => b[1].n - a[1].n)
    .map(([name, v]) => ({ label: name, value: v.n, display: v.failed ? `${v.n} · ${v.failed} failed` : String(v.n) }));

  const issues = runs
    .flatMap((r) => [
      ...r.calls.filter((c) => !c.ok).map((c) => ({ at: c.at, where: c.ref, kind: c.errorKind ?? 'error', message: c.error ?? '', run: r })),
      ...(r.reason === 'error' && r.error ? [{ at: r.startedAt + r.ms, where: 'run', kind: 'run failed', message: r.error, run: r }] : []),
    ])
    .sort((a, b) => b.at - a.at)
    .slice(0, 8);

  return (
    <div className="space-y-4 p-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold">Dashboard</h1>
          <p className="text-xs text-zinc-500">Everything the agent did in this browser: runs, model calls, failovers and errors.</p>
        </div>
        <div className="text-right text-xs text-zinc-500">
          Model chain: {chain.length ? chain.join(' → ') : <button className="text-violet-300 underline" onClick={() => go('providers')}>add a provider</button>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Runs" value={s.total} hint={`${s.toolCalls} tool calls`} />
        <Stat label="Success rate" value={s.successRate === null ? '—' : `${s.successRate}%`} hint="completed ÷ finished runs" tone={s.successRate === null ? undefined : s.successRate >= 80 ? 'green' : s.successRate >= 50 ? 'amber' : 'red'} />
        <Stat label="Tokens" value={fmtTokens(s.tokensIn + s.tokensOut)} hint={`${fmtTokens(s.tokensIn)} in · ${fmtTokens(s.tokensOut)} out · $0 on free tiers`} />
        <Stat label="Avg run time" value={s.avgMs ? fmtMs(s.avgMs) : '—'} hint={`${s.calls} model calls · ${s.failovers} failed/failover`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Runs per day (last 14 days)">
          <Columns data={s.days} />
        </Card>
        <Card title="Recent issues" actions={<button className="flex items-center gap-1 text-xs text-violet-300" onClick={() => go('runs')}>All runs <ArrowRight size={12} /></button>}>
          {!issues.length ? (
            <p className="text-xs text-zinc-500">No issues. Failed model calls and failed runs show up here with a fix.</p>
          ) : (
            <ul className="space-y-2">
              {issues.map((i, n) => (
                <li key={n} className="text-xs">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={12} className="shrink-0 text-amber-400" />
                    <span className="font-medium text-zinc-200">{i.kind.replace('_', ' ')}</span>
                    <span className="text-zinc-500">{i.where}</span>
                    <span className="ml-auto text-zinc-600">{fmtTime(i.at)}</span>
                  </div>
                  <div className="ml-5 truncate text-zinc-400" title={i.message}>{i.message}</div>
                  {ISSUE_HINTS[i.kind] && <div className="ml-5 text-zinc-500">→ {ISSUE_HINTS[i.kind]}</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Provider success rate">
          <BarList data={providerSuccess} max={100} empty="No model calls yet." />
        </Card>
        <Card title="Provider latency (avg per successful call, fastest first)">
          <BarList data={providerLatency} empty="No successful calls yet." />
        </Card>
        <Card title="Model-call errors by kind">
          <BarList data={errors} empty="No errors. 🎉" />
        </Card>
        <Card title="Tool usage">
          <BarList data={tools} empty="No tool calls yet." />
        </Card>
      </div>

      <Card title="Latest runs">
        {!runs.length ? (
          <p className="text-xs text-zinc-500">No runs yet. Build something in the Builder, or run a check in Model check.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 font-normal">When</th>
                <th className="font-normal">Prompt</th>
                <th className="font-normal">Status</th>
                <th className="text-right font-normal">Steps</th>
                <th className="text-right font-normal">Tokens</th>
                <th className="text-right font-normal">Time</th>
              </tr>
            </thead>
            <tbody>
              {runs.slice(0, 6).map((r) => (
                <tr key={r.id} className="border-t border-zinc-800 hover:bg-zinc-800/40">
                  <td className="py-1.5 text-zinc-500">{fmtTime(r.startedAt)}</td>
                  <td className="max-w-80 truncate pr-2 text-zinc-300">{r.prompt}</td>
                  <td><StatusBadge reason={r.reason} /></td>
                  <td className="text-right tabular-nums">{r.steps}</td>
                  <td className="text-right tabular-nums">{fmtTokens(r.inputTokens + r.outputTokens)}</td>
                  <td className="text-right tabular-nums">{fmtMs(r.ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
