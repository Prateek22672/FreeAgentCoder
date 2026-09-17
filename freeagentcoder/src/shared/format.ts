export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function compactNumber(value: number): string {
    const n = Math.round(value);
    if (Math.abs(n) < 1_000) {
        return String(n);
    }
    if (Math.abs(n) < 1_000_000) {
        return `${trimZero((n / 1_000).toFixed(Math.abs(n) < 10_000 ? 1 : 0))}K`;
    }
    return `${trimZero((n / 1_000_000).toFixed(Math.abs(n) < 10_000_000 ? 1 : 0))}M`;
}

export function fullNumber(value: number): string {
    return Math.round(value).toLocaleString('en-US');
}

function trimZero(text: string): string {
    return text.replace(/\.0$/, '');
}

export function formatDuration(ms: number): string {
    const seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 60) {
        return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 48) {
        return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
    }
    return `${Math.floor(hours / 24)}d`;
}

/** A response time: "850ms", "2.4s". */
export function formatLatency(ms: number): string {
    return ms < 1000 ? `${Math.round(ms)}ms` : `${trimZero((ms / 1000).toFixed(1))}s`;
}

export function formatUsd(amount: number): string {
    if (amount > 0 && amount < 0.01) {
        return '<$0.01';
    }
    return amount >= 100 ? `$${Math.round(amount).toLocaleString('en-US')}` : `$${amount.toFixed(2)}`;
}

export function formatAgo(time: number, now = Date.now()): string {
    const diff = now - time;
    if (diff < 45_000) {
        return 'just now';
    }
    if (diff < 48 * 3_600_000) {
        return `${formatDuration(diff).split(' ')[0]} ago`;
    }
    return formatDate(time);
}

export function formatDate(time: number): string {
    return new Date(time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
