'use client';

import type { Confidence, FileRole } from '@agentic/project-brain';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function cx(...classes: (string | false | null | undefined)[]): string {
    return classes.filter(Boolean).join(' ');
}

const CONFIDENCE: Record<Confidence, { label: string; className: string; title: string }> = {
    detected: { label: 'Detected', className: 'text-ok border-ok/30 bg-ok/10', title: 'Read directly from the repository' },
    inferred: { label: 'Inferred', className: 'text-warn border-warn/30 bg-warn/10', title: 'Deduced from strong signals, not stated outright' },
    estimated: { label: 'Estimated', className: 'text-muted border-line-strong bg-panel-2', title: 'A heuristic; may be off' },
};

export function ConfidenceBadge({ value }: { value: Confidence }) {
    const c = CONFIDENCE[value];
    return (
        <span title={c.title} className={cx('inline-flex items-center rounded border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide', c.className)}>
            {c.label}
        </span>
    );
}

const ROLE: Record<FileRole, string> = {
    api: 'API',
    component: 'Component',
    model: 'Model',
    service: 'Service',
    test: 'Test',
    example: 'Example',
    config: 'Config',
    doc: 'Doc',
    style: 'Style',
    other: 'Code',
};

export function RoleBadge({ role }: { role: FileRole }) {
    return <span className="rounded bg-panel-2 px-1.5 py-px font-mono text-[10px] text-muted">{ROLE[role]}</span>;
}

export function Button({ variant = 'primary', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'outline' }) {
    return (
        <button
            {...props}
            className={cx(
                'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                variant === 'primary' && 'bg-accent text-accent-fg hover:brightness-110',
                variant === 'outline' && 'border border-line-strong text-fg hover:bg-panel-2',
                variant === 'ghost' && 'text-muted hover:bg-panel-2 hover:text-fg',
                className,
            )}
        />
    );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            {...props}
            className={cx(
                'h-10 w-full min-w-0 rounded-md border border-line-strong bg-panel px-3 text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none',
                className,
            )}
        />
    );
}

export function Panel({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <section className={cx('rounded-lg border border-line bg-panel', className)}>
            {(title || action) && (
                <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
                    {action}
                </header>
            )}
            <div className="p-4">{children}</div>
        </section>
    );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
    return (
        <div className="rounded-lg border border-line bg-panel px-4 py-3" title={hint}>
            <div className="text-[11px] font-medium uppercase tracking-wider text-faint">{label}</div>
            <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-fg">{value}</div>
        </div>
    );
}

export function FileLink({ path, lines, onOpen }: { path: string; lines?: { start: number; end: number }; onOpen: (path: string, lines?: { start: number; end: number }) => void }) {
    return (
        <button
            type="button"
            onClick={() => onOpen(path, lines)}
            className="max-w-full truncate text-left font-mono text-[13px] text-fg underline decoration-line-strong underline-offset-4 hover:text-accent hover:decoration-accent"
            title={`Open ${path}`}
        >
            {path}
            {lines ? <span className="text-faint">:{lines.start}{lines.end !== lines.start ? `-${lines.end}` : ''}</span> : null}
        </button>
    );
}

export function Empty({ children }: { children: ReactNode }) {
    return <p className="py-6 text-center text-sm text-faint">{children}</p>;
}

export function Spinner({ className }: { className?: string }) {
    return <span className={cx('inline-block size-4 animate-spin rounded-full border-2 border-line-strong border-t-accent', className)} aria-hidden />;
}
