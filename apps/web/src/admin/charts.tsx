import { useState } from 'react';

/**
 * Minimal, single-series charts for the dashboard. One validated data color
 * (#3987e5 on the zinc-900 surface), thin bars with rounded data ends, value
 * labels in text ink, hover tooltips on every mark.
 */
export const SERIES = '#3987e5';
export const STATUS = { good: '#0ca30c', warning: '#fab219', critical: '#d03b3b' };

export interface BarDatum {
  label: string;
  value: number;
  /** Text shown after the bar, e.g. "92% · 41 calls". */
  display?: string;
  tooltip?: string;
}

/** Horizontal bars, sorted by the caller. The title names the single series (no legend). */
export function BarList({ data, max, empty = 'No data yet.' }: { data: BarDatum[]; max?: number; empty?: string }) {
  if (!data.length) return <p className="text-xs text-zinc-500">{empty}</p>;
  const top = max ?? Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.label} className="group grid grid-cols-[minmax(90px,30%)_1fr_auto] items-center gap-3 text-xs" title={d.tooltip ?? `${d.label}: ${d.display ?? d.value}`}>
          <span className="truncate text-zinc-300">{d.label}</span>
          <div className="h-2 rounded-r bg-zinc-800/60">
            <div className="h-2 rounded-r transition-[width] group-hover:brightness-125" style={{ width: `${Math.max(1.5, (d.value / top) * 100)}%`, background: SERIES }} />
          </div>
          <span className="tabular-nums text-zinc-400">{d.display ?? d.value}</span>
        </div>
      ))}
    </div>
  );
}

export interface ColumnDatum {
  label: string;
  value: number;
  failed: number;
}

/** Runs per day. Hovering a column shows its numbers. */
export function Columns({ data }: { data: ColumnDatum[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const top = Math.max(...data.map((d) => d.value), 1);
  const h = 96;
  return (
    <div className="relative">
      <div className="flex h-24 items-end gap-[2px] border-b border-zinc-700" onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => (
          <div key={d.label} className="flex h-full flex-1 cursor-default items-end" onMouseEnter={() => setHover(i)}>
            <div
              className="w-full rounded-t"
              style={{
                height: d.value ? Math.max(3, (d.value / top) * h) : 0,
                background: SERIES,
                opacity: hover === null || hover === i ? 1 : 0.45,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
      {hover !== null && data[hover] && (
        <div
          className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] shadow-lg"
          style={{ left: `${((hover + 0.5) / data.length) * 100}%` }}
        >
          <div className="font-medium text-zinc-100">{data[hover].label}</div>
          <div className="text-zinc-400">
            {data[hover].value} run{data[hover].value === 1 ? '' : 's'}
            {data[hover].failed ? ` · ${data[hover].failed} failed` : ''}
          </div>
        </div>
      )}
    </div>
  );
}
