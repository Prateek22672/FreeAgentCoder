import type { Tier } from '../shared/protocol';

/**
 * The tools a task is given. Every tool's definition is resent on every step
 * (about 150-350 tokens each), so a task gets only the ones its kind of work
 * uses: none for a general question, reading tools to explain, everything but
 * project search for a new build, and all of them to change existing code.
 */

/** A quick task: reading, searching, editing and one command. */
export const QUICK_TOOLS = ['read_file', 'edit_file', 'write_file', 'list_dir', 'glob', 'grep', 'search_code', 'run_command'];
/** Understanding a project: it reads, searches and checks docs; it changes nothing. */
export const READ_TOOLS = ['read_file', 'list_dir', 'glob', 'grep', 'search_code', 'library_docs'];
/** A new project has nothing to search or diagnose yet. */
const NOT_FOR_NEW = new Set(['search_code', 'grep', 'get_problems']);
export const ALL_TOOLS = [
    'read_file',
    'write_file',
    'edit_file',
    'list_dir',
    'glob',
    'grep',
    'todo_write',
    'search_code',
    'run_command',
    'process',
    'fetch_url',
    'library_docs',
    'inspect_environment',
    'check_page',
    'get_problems',
];
/** Only for work with a visual result: a found photo, and a check of the finished deck or document. */
const VISUAL_TOOLS = ['find_image'];
const DOCUMENT_TOOLS = ['find_image', 'check_document'];

export interface TaskShape {
    tier: Tier;
    /** A question about the world, not about this project: answered from knowledge, in one step. */
    general?: boolean;
    explain?: boolean;
    /** Making something new rather than changing what is there. */
    newBuild?: boolean;
    test?: boolean;
    /** Making a deck, document, report or PDF. */
    documents?: boolean;
    /** Making something people look at: a site, an app screen. */
    visual?: boolean;
}

/** The tool names for a task; undefined means all of them. */
export function toolsFor(task: TaskShape): string[] | undefined {
    if (task.test) {
        return undefined;
    }
    if (task.general) {
        return [];
    }
    if (task.explain) {
        return READ_TOOLS;
    }
    const extra = task.documents ? DOCUMENT_TOOLS : task.visual ? VISUAL_TOOLS : [];
    if (task.tier === 'fast') {
        return [...QUICK_TOOLS, ...extra];
    }
    return [...(task.newBuild ? ALL_TOOLS.filter((t) => !NOT_FOR_NEW.has(t)) : ALL_TOOLS), ...extra];
}
