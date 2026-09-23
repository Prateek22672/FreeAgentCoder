/** Response shapes shared by the API routes and the client. Types only. */
import type { Analysis, FileRole, GroundedAnswer, ImpactResult } from '@agentic/project-brain';

export interface AnalyzeResponse {
    id: string;
    analysis: Analysis;
    secrets: { path: string; kind: string }[];
    timings: { download: number; analyze: number; index: number };
    indexedFiles: number;
    /** Every file whose text was read: the only paths the UI links to. */
    readPaths: string[];
    /** Providers with a key configured on the server, for Ask. */
    ai: string[];
}

export interface SearchHitView {
    path: string;
    start: number;
    end: number;
    matched: string[];
    role: FileRole;
    snippet: string;
    snippetStart: number;
}

export type AskEvent =
    | { type: 'evidence'; files: string[]; access?: AskAccess }
    | { type: 'model'; ref: string }
    | { type: 'text'; delta: string }
    | { type: 'reset' }
    | { type: 'done'; model: string; grounding: GroundedAnswer }
    | { type: 'error'; message: string };

/** How a question was paid for: the visitor's own key, or a free trial question. */
export type AskAccess = { mode: 'own'; provider: string } | { mode: 'trial'; remaining: number; limit: number };

export type { ImpactResult };
