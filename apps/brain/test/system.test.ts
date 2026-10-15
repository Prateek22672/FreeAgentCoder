import { describe, expect, it } from 'vitest';
import { buildSystem, overall, type SystemInput } from '../lib/system';

const base: SystemInput = {
    installs: 451,
    active: { today: 12, week: 60, month: 140 },
    versions: [{ version: '0.6.1', installs: 40 }, { version: '0.6.0', installs: 20 }],
    totals: { tasks: 300, done: 270, failed: 20, stopped: 10, fyxTasks: 80, fyxTokensSaved: 900_000 },
    daily: [],
    failures: [{ cause: 'gemini:daily-limit', times: 30 }, { cause: 'groq:rate-limit', times: 12 }],
    providerInstalls: [{ provider: 'gemini', installs: 50 }, { provider: 'groq', installs: 30 }],
    score: { score: 78, parts: [{ name: 'Checked', value: 0.7, detail: '70 of 100' }, { name: 'Success', value: 0.9, detail: '270 of 290' }], tasks: 300, tokensPerTask: 60_000, requestsPerTask: 9 },
    trial: { enabled: true, requests: 400, installs: 30, refused: 5, failed: 2, tokens: 3_000_000, cap: 975, bonusTokens: 300_000, bonuses: 4 },
    pool: [{ provider: 'gemini', enabled: true, benched: false, state: 'ok', okToday: 200, failedToday: 3 }],
    models: [{ tier: 'deep', provider: 'gemini', model: 'gemini-3.8-flash', tasks: 120, completed: 110, corrected: 8, avg_steps: 9, avg_tokens: 70_000, good: 10, bad: 1 }],
    feedback: { good: 20, bad: 4, reasons: { 'too-slow': 3 } },
    lessons: { pending: 3, approved: 12 },
    errors: [{ signature: 'edit_file: old_string not found', tool: 'edit_file', occurrences: 40, repeats: 9, status: 'new' }],
    lab: { runs: 6, lastAt: Date.now(), passRate: 0.8, failing: [] },
    events: [{ at: Date.now(), source: 'trial:groq', level: 'warn', message: '503: overloaded' }],
    learningAvailable: true,
};

describe('the System page model', () => {
    it('has a node for every part, connected from request to learning, with the loops back', () => {
        const { nodes, edges } = buildSystem(base);
        expect(nodes.map((x) => x.id)).toEqual(expect.arrayContaining(['editor', 'intent', 'router', 'gemini', 'groq', 'nvidia', 'openrouter', 'trial', 'tools', 'checks', 'outcome', 'learning', 'lab']));
        for (const e of edges) {
            expect(nodes.some((x) => x.id === e.from) && nodes.some((x) => x.id === e.to)).toBe(true);
        }
        expect(edges.filter((e) => e.loop).map((e) => e.to)).toContain('router');
        for (const node of nodes) {
            expect(node.how.length).toBeGreaterThan(20);
            expect(node.strengths.length && node.weaknesses.length && node.next.length).toBeTruthy();
        }
    });

    it('reads health from the numbers', () => {
        const { nodes } = buildSystem(base);
        const by = (id: string) => nodes.find((x) => x.id === id)!;
        expect(by('gemini').health).toBe('ok');
        expect(by('nvidia').health).toBe('idle');
        expect(by('trial').issues.join(' ')).toContain('503: overloaded');
        expect(by('outcome').metric).toBe('Quality score 78');
        const down = buildSystem({ ...base, trial: { ...base.trial, enabled: false }, learningAvailable: false }).nodes;
        expect(down.find((x) => x.id === 'trial')!.health).toBe('down');
        expect(overall(down)).toBe('down');
    });
});
