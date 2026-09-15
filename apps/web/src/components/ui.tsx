import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'ghost' | 'danger' | 'outline';

export function Button({ variant = 'outline', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-violet-600 hover:bg-violet-500 text-white border-transparent',
    ghost: 'bg-transparent hover:bg-zinc-800 text-zinc-300 border-transparent',
    danger: 'bg-red-600/90 hover:bg-red-500 text-white border-transparent',
    outline: 'bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border-zinc-700',
  };
  return (
    <button
      {...props}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        styles[variant],
        className,
      )}
    />
  );
}

export function Badge({ children, tone = 'zinc' }: { children: ReactNode; tone?: 'zinc' | 'green' | 'red' | 'amber' | 'violet' | 'blue' }) {
  const tones = {
    zinc: 'bg-zinc-800 text-zinc-300',
    green: 'bg-emerald-500/15 text-emerald-300',
    red: 'bg-red-500/15 text-red-300',
    amber: 'bg-amber-500/15 text-amber-300',
    violet: 'bg-violet-500/15 text-violet-300',
    blue: 'bg-sky-500/15 text-sky-300',
  };
  return <span className={cx('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium', tones[tone])}>{children}</span>;
}

export function Card({ title, children, actions, className }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-lg border border-zinc-800 bg-zinc-900/60', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'green' | 'red' | 'amber' }) {
  const color = tone === 'green' ? 'text-emerald-300' : tone === 'red' ? 'text-red-300' : tone === 'amber' ? 'text-amber-300' : 'text-zinc-100';
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={cx('mt-1 text-2xl font-semibold tabular-nums', color)}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 100_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
