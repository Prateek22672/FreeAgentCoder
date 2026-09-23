/**
 * Re-ranking for search hits. The index scores text; a developer asking
 * "where is authentication handled" wants the implementation, not the tests
 * that exercise it or the changelog that mentions it. So implementation files
 * are weighted up and tests, docs and examples down — unless the query asks for
 * exactly those.
 */
import { roleOf } from './structure';
import type { FileRole } from './types';

const WEIGHT: Record<FileRole, number> = {
    api: 1.3,
    model: 1.3,
    service: 1.25,
    component: 1.15,
    other: 1.0,
    config: 0.6,
    test: 0.5,
    example: 0.45,
    style: 0.4,
    doc: 0.35,
};

const WANTS: [RegExp, FileRole][] = [
    [/\b(tests?|spec|specs|testing|coverage|fixtures?)\b/i, 'test'],
    [/\b(docs?|documentation|readme|changelog|guide)\b/i, 'doc'],
    [/\b(examples?|demos?|samples?)\b/i, 'example'],
    [/\b(config|configuration|settings|env|docker|ci)\b/i, 'config'],
    [/\b(styles?|css|theme|colou?rs?)\b/i, 'style'],
];

export function rankHits<T extends { path: string; score: number }>(hits: T[], query: string, limit = hits.length): T[] {
    const wanted = new Set(WANTS.filter(([re]) => re.test(query)).map(([, role]) => role));
    return hits
        .map((hit) => {
            const role = roleOf(hit.path);
            return { hit, score: hit.score * (wanted.has(role) ? 1.3 : WEIGHT[role]) };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((entry) => entry.hit);
}
