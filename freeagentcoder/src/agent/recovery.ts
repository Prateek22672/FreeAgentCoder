import { isDailyLimit } from '../usage/forecast';

const TEMPORARY =
    /rate limit|rate-limited|cooling down|too many requests|timed out|timeout|network|fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|server error|overloaded|unavailable|stream ended early|\b50[0-4]\b/i;
const OFFLINE = /fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i;
const FINAL = /larger than any configured model|declined to continue|No model is configured/i;
const AUTH = /invalid api key|api key not valid|unauthori[sz]ed|authentication|\b401\b|\b403\b/i;

/** Whether an error means the conversation no longer fits any model, which summarizing it can fix. */
export function isContextTooLarge(message: string): boolean {
    return /larger than any configured model/i.test(message);
}

function failureReasons(message: string): string[] {
    return message.startsWith('Every model failed') ? message.split('\n').slice(1).filter((line) => line.trim()) : [message];
}

/** Whether a turn-ending error is temporary enough to wait out and resume automatically. */
export function recoveryFor(message: string, attempt: number): { delayMs: number; explanation: string; action: string } | undefined {
    if (attempt >= 2 || FINAL.test(message)) {
        return undefined;
    }
    // A daily limit won't come back in a minute or two, so waiting only delays the real message.
    const waitable = failureReasons(message).filter((line) => TEMPORARY.test(line) && !isDailyLimit(line));
    if (!waitable.length) {
        return undefined;
    }
    const delayMs = attempt === 0 ? 30_000 : 90_000;
    return {
        delayMs,
        explanation: waitable.every((line) => OFFLINE.test(line)) ? 'The connection to the AI providers dropped.' : 'Every model is busy or rate-limited right now.',
        action: `Waited ${delayMs / 1000}s and resumed the task`,
    };
}

/** A turn-ending error in plain language: what happened, what to do, and whether a key fixes it. */
export function explainError(message: string): { title: string; hint: string; action?: 'openKeys' } {
    const reasons = failureReasons(message);
    const all = (test: (line: string) => boolean) => reasons.length > 0 && reasons.every(test);
    if (/No model is configured/i.test(message)) {
        return { title: 'No API key is ready to use', hint: 'Add a free key in Settings → API Keys to start.', action: 'openKeys' };
    }
    if (isContextTooLarge(message)) {
        return {
            title: 'This conversation is too long for your models',
            hint: 'Start a new chat to continue. A Gemini key helps a lot here: it accepts about 1M tokens at once.',
            action: 'openKeys',
        };
    }
    if (all((line) => isDailyLimit(line))) {
        return {
            title: "Today's free limits on your keys are used up",
            hint: 'They reset within a day. To keep working now, add a key from a provider you have not used today.',
            action: 'openKeys',
        };
    }
    if (all((line) => AUTH.test(line))) {
        return { title: 'Your keys were rejected by their providers', hint: 'Test or replace them in Settings → API Keys.', action: 'openKeys' };
    }
    if (all((line) => OFFLINE.test(line))) {
        return { title: "Couldn't reach the AI providers", hint: 'Check your internet connection, then send your message again. Nothing was lost.' };
    }
    if (all((line) => TEMPORARY.test(line))) {
        return {
            title: 'Every model is busy or rate-limited',
            hint: 'Waiting did not free one up. Try again in a few minutes, or add a key from another provider so there is always one free.',
            action: 'openKeys',
        };
    }
    if (/Every model failed/i.test(message)) {
        return {
            title: 'None of your keys could complete this request',
            hint: "Each key's status and last error are in Settings → Health. Adding a key from another provider usually fixes this.",
            action: 'openKeys',
        };
    }
    return { title: 'The task stopped because of an unexpected error', hint: 'Send your message again to retry. If it keeps happening, Settings → Logs has the details.' };
}
