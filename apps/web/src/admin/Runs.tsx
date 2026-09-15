import { AlertTriangle, Check, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, cx, fmtMs, fmtTime, fmtTokens } from '../components/ui';
import { db, notifyRunsChanged, type RunRecord } from '../lib/db';
import { Markdown } from '../lib/markdown';
import { ISSUE_HINTS, useRuns } from '../lib/useRuns';
import { StatusBadge } from './StatusBadge';

function Detail({ run }: { run: RunRecord }) {
  return (
    <div className="space-y-4">
      <div>
        <div className="text-[11px] uppercase tracking-wide text-zinc-500">Prompt</div>
        <div className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">{run.prompt}</div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <StatusBadge reason={run.reason} />
        <Badge>{run.steps} steps</Badge>
        <Badge>{fmtMs(run.ms)}</Badge>
        <Badge>{fmtTokens(run.inputTokens)} in · {fmtTokens(run.outputTokens)} out</Badge>
        {run.compactions > 0 && <Badge tone="blue">{run.compactions} compaction{run.compactions > 1 ? 's' : ''}</Badge>}
        {run.models.map((m) => <Badge key={m} tone="violet">{m}</Badge>)}
      </div>
      {run.error && (
        <div className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <div className="font-medium">Error</div>
          <div className="mt-0.5 whitespace-pre-wrap">{run.error}</div>
        </div>
      )}

      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">Tool steps ({run.tools.length})</div>
        <ol className="space-y-1">
          {run.tools.map((t, i) => (
            <li key={i} className="flex items-start gap-2 text-xs">
              <span className="w-5 shrink-0 text-right tabular-nums text-zinc-600">{i + 1}</span>
              {t.denied ? <X size={12} className="mt-0.5 text-amber-400" /> : t.ok ? <Check size={12} className="mt-0.5 text-emerald-400" /> : <AlertTriangle size={12} className="mt-0.5 text-red-400" />}
              <div className="min-w-0 flex-1">
                <span className="text-zinc-200">{t.label}</span>
                <span className="ml-2 text-zinc-500">{t.denied ? 'declined' : t.summary}</span>
                {t.error && <div className="truncate text-red-300/80" title={t.error}>{t.error}</div>}
              </div>
              <span className="tabular-nums text-zinc-500">{fmtMs(t.ms)}</span>
            </li>
          ))}
          {!run.tools.length && <li className="text-xs text-zinc-500">No tools used.</li>}
        </ol>
      </div>

      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">Model calls ({run.calls.length})</div>
        <table className="w-full text-xs">
          <tbody>
            {run.calls.map((c, i) => (
              <tr key={i} className="border-t border-zinc-800 align-top">
                <td className="py-1 pr-2">{c.ok ? <Check size={12} className="text-emerald-400" /> : <AlertTriangle size={12} className="text-red-400" />}</td>
                <td className="pr-2 text-zinc-300">{c.ref}</td>
                <td className="pr-2 text-zinc-500">
                  {c.ok ? `${fmtTokens(c.inputTokens ?? 0)} in · ${fmtTokens(c.outputTokens ?? 0)} out` : (
                    <span title={ISSUE_HINTS[c.errorKind ?? ''] ?? ''} className="text-red-300/90">
                      {c.errorKind}: {c.error?.slice(0, 140)}
                    </span>
                  )}
                </td>
                <td className="text-right tabular-nums text-zinc-500">{fmtMs(c.ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {run.notices.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">Router notices</div>
          <ul className="space-y-0.5 text-xs text-amber-200/90">{run.notices.map((n, i) => <li key={i}>• {n}</li>)}</ul>
        </div>
      )}

      {run.reply && (
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">Final reply</div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3"><Markdown text={run.reply} /></div>
        </div>
      )}
    </div>
  );
}

export function Runs() {
  const runs = useRuns();
  const [filter, setFilter] = useState<'all' | 'failed' | 'completed'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const shown = runs.filter((r) => (filter === 'all' ? true : filter === 'failed' ? r.reason === 'error' || r.reason === 'max_steps' : r.reason === 'completed'));
  const current = runs.find((r) => r.id === selected) ?? shown[0];

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(380px,45%)_1fr]">
      <div className="flex min-h-0 flex-col border-r border-zinc-800">
        <div className="flex items-center gap-2 border-b border-zinc-800 p-3">
          <h1 className="text-sm font-semibold">Runs</h1>
          <div className="ml-2 flex gap-1">
            {(['all', 'completed', 'failed'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={cx('rounded px-2 py-0.5 text-xs capitalize', filter === f ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200')}>
                {f}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            className="ml-auto"
            onClick={async () => {
              if (!confirm('Delete the whole run history?')) return;
              await db.clearRuns();
              notifyRunsChanged();
            }}
          >
            <Trash2 size={13} /> Clear
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {!shown.length && <p className="p-4 text-xs text-zinc-500">No runs match.</p>}
          {shown.map((r) => (
            <button key={r.id} onClick={() => setSelected(r.id)} className={cx('block w-full border-b border-zinc-800/70 px-3 py-2 text-left hover:bg-zinc-800/40', current?.id === r.id && 'bg-zinc-800/60')}>
              <div className="flex items-center gap-2 text-xs">
                <StatusBadge reason={r.reason} />
                <span className="text-zinc-500">{r.projectName}</span>
                <span className="ml-auto text-zinc-600">{fmtTime(r.startedAt)}</span>
              </div>
              <div className="mt-1 truncate text-[13px] text-zinc-200">{r.prompt}</div>
              <div className="mt-0.5 text-[11px] text-zinc-500">
                {r.steps} steps · {r.tools.length} tools · {fmtTokens(r.inputTokens + r.outputTokens)} tokens · {fmtMs(r.ms)} · {r.models.join(', ')}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 overflow-auto p-4">
        {current ? <Card title="Run detail"><Detail run={current} /></Card> : <p className="text-xs text-zinc-500">Select a run.</p>}
      </div>
    </div>
  );
}
