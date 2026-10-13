/**
 * The friendly line under a long task's status: what is going on and roughly
 * how long is left, said the way a teammate would. Silent for the first 90
 * seconds; after that it changes once a minute, never every second.
 */

export interface Progress {
    done: number;
    total: number;
}

const MINUTE = 60_000;

function minutes(ms: number): string {
    const m = Math.max(1, Math.round(ms / MINUTE));
    return m === 1 ? 'about a minute' : m <= 3 ? `about ${m} minutes` : `around ${m} minutes`;
}

/** Time left from the plan so far: the average step time times the steps left. Unknown until a step is done. */
export function estimateLeft(elapsedMs: number, progress: Progress): number | undefined {
    if (progress.total < 2 || progress.done < 1 || progress.done >= progress.total) {
        return undefined;
    }
    return (elapsedMs / progress.done) * (progress.total - progress.done);
}

export function patienceNote(elapsedMs: number, progress: Progress): string | undefined {
    if (elapsedMs < 90_000) {
        return undefined;
    }
    const minute = Math.floor(elapsedMs / MINUTE);
    const left = estimateLeft(elapsedMs, progress);
    const steps = progress.total ? `${progress.done} of ${progress.total} steps done` : '';
    if (left !== undefined) {
        const lines = [
            `Still going! ${steps}, ${minutes(left)} left, I think.`,
            `Making progress: ${steps}. Give me ${minutes(left)} more.`,
            `${steps}. Hang tight, ${minutes(left)} to go.`,
        ];
        return lines[minute % lines.length];
    }
    if (elapsedMs >= 12 * MINUTE) {
        const lines = [
            'Sorry, this one is taking a while. It’s a big job, but I’m still on it.',
            'Thanks for hanging in there. Still working through it, and I’ll tell you the moment it’s done.',
        ];
        return lines[minute % lines.length];
    }
    const lines = [
        'Still on it! Bigger tasks take a few minutes.',
        'Still working, sorry for the wait. Checking things properly takes a moment.',
        `Still going${steps ? `, ${steps}` : ''}. Feel free to grab a coffee.`,
    ];
    return lines[minute % lines.length];
}
