import { isDailyLimit } from '../usage/forecast';

const TEMPORARY =
    /rate limit|rate-limited|cooling down|too many requests|timed out|timeout|network|fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|server error|overloaded|unavailable|stream ended early|\b50[0-4]\b/i;
const OFFLINE = /fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i;
const FINAL = /larger than any configured model|too small for this task|declined to continue|No model is configured/i;
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
        return { title: 'No API key is ready to use', hint: 'Add a free key in Settings → API Keys and we’re off. It takes about a minute, and no card is needed.', action: 'openKeys' };
    }
    if (/too small for this task/i.test(message)) {
        return {
            title: 'Sorry, the models free right now are too small for this task',
            hint: "Only models that take a few thousand tokens per request can answer at the moment: Groq's free tier, or the free trial while its larger models are busy. Add a free Gemini key in Settings → API Keys (it takes about 1M tokens per request), then press Continue.",
            action: 'openKeys',
        };
    }
    if (isContextTooLarge(message)) {
        return {
            title: 'Sorry, this conversation got too long for your models',
            hint: 'Start a new chat and pick up from there; nothing in your project is lost. A free Gemini key helps a lot here: it takes about 1M tokens at once.',
            action: 'openKeys',
        };
    }
    if (all((line) => isDailyLimit(line))) {
        return {
            title: "Sorry, today's free limits on your keys are used up",
            hint: 'They reset within a day. Want to keep going now? Add a key from a provider you haven’t used today and press Continue.',
            action: 'openKeys',
        };
    }
    if (all((line) => AUTH.test(line))) {
        return { title: 'Your keys were rejected by their providers', hint: 'They may have expired or been revoked. Test or replace them in Settings → API Keys and we’ll carry on.', action: 'openKeys' };
    }
    if (all((line) => OFFLINE.test(line))) {
        return { title: "Couldn't reach the AI providers", hint: 'Looks like the connection dropped. Check your internet, then send your message again. Nothing was lost.' };
    }
    if (all((line) => TEMPORARY.test(line))) {
        return {
            title: 'Every model is busy or rate-limited',
            hint: 'Sorry, I waited but none freed up. Try again in a few minutes, or add a key from another provider so one is always free.',
            action: 'openKeys',
        };
    }
    if (/Every model failed/i.test(message)) {
        return {
            title: 'None of your keys could complete this request',
            hint: "Sorry about that. Each key's status and last error are in Settings → Health, and a key from another provider usually fixes it.",
            action: 'openKeys',
        };
    }
    return { title: 'Sorry, the task stopped because of an unexpected error', hint: 'Send your message again and I’ll retry. If it keeps happening, Settings → Logs has the details.' };
}
