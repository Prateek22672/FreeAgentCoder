import type { ToWebview } from '../shared/protocol';

/**
 * Records one test-lab run as it happens: for each prompt, how it ended, the
 * time, tokens, requests and steps, the models used and the files changed,
 * plus the conversation as plain text. Fed every message the panel receives.
 */

export interface LabTurn {
    prompt: string;
    reason: string;
    durationMs: number;
    tokens: number;
    steps: number;
    requests: number;
    models: string[];
    filesChanged: string[];
    usedFyx: boolean;
}

export class LabRecorder {
    readonly turns: LabTurn[] = [];
    private readonly lines: string[] = [];
    private current?: { prompt: string; models: Set<string>; text: string };
    private ended = false;

    get transcript(): string {
        return this.lines.join('\n');
    }

    /** Called before each prompt is sent. */
    begin(prompt: string, index: number): void {
        this.current = { prompt, models: new Set(), text: '' };
        this.ended = false;
        this.lines.push('', `## Prompt ${index + 1}`, `> ${prompt}`, '');
    }

    /** Called after a prompt has been handled: covers a request refused before any turn started. */
    finish(): void {
        if (this.current && !this.ended) {
            this.turns.push({ prompt: this.current.prompt, reason: 'not-started', durationMs: 0, tokens: 0, steps: 0, requests: 0, models: [], filesChanged: [], usedFyx: false });
        }
        this.current = undefined;
    }

    capture(message: ToWebview, live: { requests: number; fyx: boolean }): void {
        const turn = this.current;
        if (!turn) {
            return;
        }
        switch (message.type) {
            case 'model':
                turn.models.add(`${message.providerLabel} · ${message.model}`);
                break;
            case 'text':
                turn.text += message.delta;
                break;
            case 'resetText':
                turn.text = '';
                break;
            case 'assistant':
                this.flushText(message.content);
                break;
            case 'toolEnd':
                this.flushText();
                this.lines.push(`- ${message.ok ? '✓' : message.denied ? '⊘ denied' : '✕'} ${message.label}${message.summary ? ` (${message.summary})` : ''}`);
                if (!message.ok && message.error) {
                    this.lines.push(`    ${message.error.split('\n').slice(0, 4).join('\n    ')}`);
                }
                break;
            case 'notice':
                this.lines.push(`> note: ${message.message}`);
                break;
            case 'error':
                this.lines.push(`> error: ${message.message}${message.hint ? ` — ${message.hint}` : ''}`);
                break;
            case 'turnEnd':
                this.flushText();
                this.ended = true;
                this.turns.push({
                    prompt: turn.prompt,
                    reason: message.reason,
                    durationMs: message.durationMs,
                    tokens: message.tokens,
                    steps: message.steps,
                    requests: live.requests,
                    models: [...turn.models],
                    filesChanged: message.files.map((f) => f.path),
                    usedFyx: live.fyx,
                });
                this.lines.push(
                    '',
                    `[${message.reason} · ${Math.round(message.durationMs / 1000)} s · ${message.tokens} tokens · ${live.requests} requests · ${message.steps} steps${live.fyx ? ' · Fyx' : ''}]`,
                );
                break;
            default:
                break;
        }
    }

    private flushText(final?: string): void {
        const turn = this.current;
        const text = (final ?? turn?.text ?? '').trim();
        if (turn) {
            turn.text = '';
        }
        if (text) {
            this.lines.push('', text, '');
        }
    }
}
