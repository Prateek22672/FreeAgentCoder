import { createHash } from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { tokenize } from '@agentic/core';
import type { LessonScope, LessonView } from '../shared/protocol';

const STORAGE_KEY = 'freeagentcoder.memory.v1';
const MAX_PER_PROJECT = 40;
const MAX_GLOBAL = 25;
const MAX_TEXT = 240;

export interface Lesson extends LessonView {
    projectId?: string;
}

export function projectIdOf(root: string): string {
    return createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 16);
}

function words(text: string): Set<string> {
    return new Set(tokenize(text));
}

/** Word overlap (Jaccard) between two lessons, so near-duplicates aren't stored twice. */
export function similarity(a: string, b: string): number {
    const x = words(a);
    const y = words(b);
    if (!x.size || !y.size) {
        return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
    }
    let shared = 0;
    for (const word of x) {
        if (y.has(word)) {
            shared++;
        }
    }
    return shared / (x.size + y.size - shared);
}

export function lessonsBlock(lessons: LessonView[]): string {
    return `## Lessons from this user's earlier corrections\nFollow these unless the current request says otherwise:\n${lessons.map((l) => `- ${l.text}`).join('\n')}`;
}

/**
 * Lessons the agent learned from the user's corrections (or that the user
 * asked it to remember), per project or for every project. Stored on this
 * computer only, in VS Code's storage for the extension.
 */
export class MemoryStore implements vscode.Disposable {
    private lessons: Lesson[];
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChange = this.changed.event;

    constructor(private readonly state: vscode.Memento) {
        this.lessons = state.get<Lesson[]>(STORAGE_KEY, []).filter((l) => l && typeof l.text === 'string' && typeof l.id === 'string');
    }

    /** Lessons that apply in this project: its own plus the global ones, newest first. */
    list(root?: string): Lesson[] {
        const id = root ? projectIdOf(root) : undefined;
        return this.lessons.filter((l) => l.scope === 'global' || (id !== undefined && l.projectId === id)).sort((a, b) => b.createdAt - a.createdAt);
    }

    add(input: { text: string; scope: LessonScope; source: Lesson['source']; root?: string }): { lesson: Lesson; added: boolean } | undefined {
        const text = input.text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
        if (text.length < 8) {
            return undefined;
        }
        const scope: LessonScope = input.scope === 'global' || !input.root ? 'global' : 'project';
        const projectId = scope === 'project' && input.root ? projectIdOf(input.root) : undefined;
        // Only near-identical wording counts as a duplicate: "run flutter analyze" and "run flutter test" are different lessons.
        const existing = this.lessons.find((l) => l.scope === scope && l.projectId === projectId && similarity(l.text, text) >= 0.8);
        if (existing) {
            existing.text = text;
            existing.createdAt = Date.now();
            this.save();
            return { lesson: existing, added: false };
        }
        const lesson: Lesson = {
            id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
            text,
            scope,
            source: input.source,
            createdAt: Date.now(),
            projectId,
            project: projectId && input.root ? path.basename(input.root) : undefined,
        };
        this.lessons.unshift(lesson);
        this.trim(projectId);
        this.save();
        return { lesson, added: true };
    }

    remove(id: string): boolean {
        const before = this.lessons.length;
        this.lessons = this.lessons.filter((l) => l.id !== id);
        if (this.lessons.length === before) {
            return false;
        }
        this.save();
        return true;
    }

    /** The lessons most related to a request (all of them when there are only a few). */
    forPrompt(root: string, prompt: string, limit = 8): Lesson[] {
        const all = this.list(root);
        if (all.length <= limit) {
            return all;
        }
        const terms = words(prompt);
        return all
            .map((lesson, index) => ({
                lesson,
                score: [...words(lesson.text)].filter((w) => terms.has(w)).length * 10 + (all.length - index) / all.length,
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map((entry) => entry.lesson);
    }

    dispose(): void {
        this.changed.dispose();
    }

    private trim(projectId?: string): void {
        const scoped = this.lessons.filter((l) => l.projectId === projectId);
        const max = projectId ? MAX_PER_PROJECT : MAX_GLOBAL;
        if (scoped.length <= max) {
            return;
        }
        const drop = new Set(scoped.sort((a, b) => b.createdAt - a.createdAt).slice(max).map((l) => l.id));
        this.lessons = this.lessons.filter((l) => !drop.has(l.id));
    }

    private save(): void {
        void this.state.update(STORAGE_KEY, this.lessons);
        this.changed.fire();
    }
}
