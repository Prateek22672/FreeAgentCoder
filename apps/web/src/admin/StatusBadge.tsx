import { AlertOctagon, CheckCircle2, Loader2, PauseCircle, XCircle } from 'lucide-react';
import type { RunRecord } from '../lib/db';

/** Run state: always icon + label, never color alone. */
export function StatusBadge({ reason }: { reason: RunRecord['reason'] }) {
  const map = {
    completed: { icon: <CheckCircle2 size={12} />, label: 'Completed', cls: 'text-emerald-300 bg-emerald-500/10' },
    error: { icon: <AlertOctagon size={12} />, label: 'Failed', cls: 'text-red-300 bg-red-500/10' },
    aborted: { icon: <XCircle size={12} />, label: 'Stopped', cls: 'text-zinc-300 bg-zinc-700/40' },
    max_steps: { icon: <PauseCircle size={12} />, label: 'Paused', cls: 'text-amber-300 bg-amber-500/10' },
    running: { icon: <Loader2 size={12} className="animate-spin" />, label: 'Running', cls: 'text-sky-300 bg-sky-500/10' },
  }[reason];
  return <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${map.cls}`}>{map.icon}{map.label}</span>;
}
