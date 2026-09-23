/**
 * The import graph: who depends on whom.
 *
 * Deliberately not a full parser. It reads import and require statements with
 * regexes and resolves relative paths against the file list, which is accurate
 * enough for "what else would this change touch" and cheap enough to run on
 * every repository without a build step. Unresolved imports are kept as
 * external package names.
 */
import type { RepoFile } from './types';

const JS_PATTERNS: RegExp[] = [
    // import x from 'y' / export * from 'y' — including multi-line import lists
    /(?:^|\n)\s*(?:import|export)\s[^;]{0,2000}?\sfrom\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    // require('y') and dynamic import('y')
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** from x.y import a, b / from .x import (a, b) / from . import views */
const PY_FROM = /(?:^|\n)[ \t]*from\s+(\.+[\w.]*|[A-Za-z_][\w.]*)\s+import\s+(?:\(([^)]*)\)|([^\n#]*))/g;
/** import x.y, import x as y */
const PY_IMPORT = /(?:^|\n)[ \t]*import\s+([A-Za-z_][\w.]*)/g;

/**
 * What a Python import statement refers to. `from app.api.routes import login`
 * may import the module routes/login.py rather than a name from routes, so
 * each imported name is tried as a submodule as well.
 */
function pythonSpecifiers(text: string): { module: string; names: string[] }[] {
    const out: { module: string; names: string[] }[] = [];
    for (const match of text.matchAll(PY_FROM)) {
        const names = (match[2] ?? match[3] ?? '')
            .split(',')
            .map((part) => part.trim().split(/\s+as\s+/)[0]?.trim() ?? '')
            .filter((name) => /^\w+$/.test(name));
        if (match[1]) out.push({ module: match[1], names });
    }
    for (const match of text.matchAll(PY_IMPORT)) if (match[1]) out.push({ module: match[1], names: [] });
    return out;
}

const GO_PATTERNS: RegExp[] = [/(?:^|\n)\s*(?:import\s+)?(?:\w+\s+)?"([a-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)"/g];

function patternsFor(path: string): RegExp[] {
    return path.endsWith('.go') ? GO_PATTERNS : JS_PATTERNS;
}

const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro', '.py', '.go', '.rs', '.dart'];
const INDEXES = ['/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/__init__.py', '/mod.rs'];

export interface ImportGraph {
    /** file -> repository files it imports. */
    out: Map<string, Set<string>>;
    /** file -> repository files that import it. */
    in: Map<string, Set<string>>;
    /** file -> external package names it imports. */
    external: Map<string, Set<string>>;
    /** package name -> files importing it. */
    byPackage: Map<string, Set<string>>;
}

function dirname(path: string): string {
    const slash = path.lastIndexOf('/');
    return slash === -1 ? '' : path.slice(0, slash);
}

function normalize(path: string): string {
    const parts: string[] = [];
    for (const segment of path.split('/')) {
        if (!segment || segment === '.') continue;
        if (segment === '..') parts.pop();
        else parts.push(segment);
    }
    return parts.join('/');
}

/** Every ancestor folder of a file, nearest first, ending with the repository root (''). */
function ancestors(path: string): string[] {
    const out: string[] = [];
    let dir = dirname(path);
    while (dir) {
        out.push(dir);
        dir = dirname(dir);
    }
    out.push('');
    return out;
}

const join = (dir: string, rest: string) => normalize(dir ? `${dir}/${rest}` : rest);

/**
 * Python modules resolve against a source root that is usually not the
 * repository root ("backend/app/models.py" is imported as "app.models"), so try
 * every ancestor of the importing file, nearest first.
 */
function resolvePython(from: string, specifier: string, files: Set<string>): string | undefined {
    if (specifier.startsWith('.')) {
        const dots = /^\.+/.exec(specifier)?.[0].length ?? 1;
        let dir = dirname(from);
        for (let i = 1; i < dots; i++) dir = dirname(dir);
        const rest = specifier.slice(dots).split('.').filter(Boolean).join('/');
        return rest ? tryCandidates(join(dir, rest), files) : tryCandidates(join(dir, '__init__'), files);
    }
    const rest = specifier.split('.').join('/');
    for (const root of ancestors(from)) {
        const hit = tryCandidates(join(root, rest), files);
        if (hit) return hit;
    }
    return undefined;
}

/** Resolve a specifier to a file in the repository, or undefined if it is external. */
export function resolveImport(from: string, specifier: string, files: Set<string>): string | undefined {
    if (from.endsWith('.py')) return resolvePython(from, specifier, files);
    if (specifier.startsWith('.')) return tryCandidates(normalize(`${dirname(from)}/${specifier}`), files);
    if (specifier.startsWith('@/') || specifier.startsWith('~/') || specifier.startsWith('#/')) {
        // The common "project root" aliases, resolved against the nearest folder
        // that has a matching file — which handles monorepos without parsing tsconfig.
        const rest = specifier.slice(2);
        for (const root of ancestors(from)) {
            for (const sub of ['src', 'app', '']) {
                const hit = tryCandidates(join(sub ? join(root, sub) : root, rest), files);
                if (hit) return hit;
            }
        }
    }
    return undefined;
}

function tryCandidates(base: string, files: Set<string>): string | undefined {
    for (const ext of EXTENSIONS) {
        const candidate = `${base}${ext}`;
        if (files.has(candidate)) return candidate;
    }
    for (const index of INDEXES) {
        const candidate = `${base}${index}`;
        if (files.has(candidate)) return candidate;
    }
    return undefined;
}

/** The first path segment of a package specifier ("@scope/name" or "name"). */
export function packageNameOf(specifier: string): string {
    const parts = specifier.split('/');
    return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

export function buildImportGraph(files: RepoFile[]): ImportGraph {
    const paths = new Set(files.map((f) => f.path));
    const graph: ImportGraph = { out: new Map(), in: new Map(), external: new Map(), byPackage: new Map() };

    const link = (map: Map<string, Set<string>>, key: string, value: string) => {
        const set = map.get(key) ?? new Set<string>();
        set.add(value);
        map.set(key, set);
    };

    const external = (from: string, name: string) => {
        // Skip the standard-library noise that tells us nothing.
        if (name.length > 1 && !/^(os|sys|re|json|time|math|typing|node:|std)$/.test(name)) {
            link(graph.external, from, name);
            link(graph.byPackage, name, from);
        }
    };

    for (const file of files) {
        if (file.path.endsWith('.py')) {
            for (const { module, names } of pythonSpecifiers(file.text)) {
                const targets = new Set<string>();
                const base = resolveImport(file.path, module, paths);
                if (base) targets.add(base);
                for (const name of names) {
                    const sub = resolveImport(file.path, module.endsWith('.') ? `${module}${name}` : `${module}.${name}`, paths);
                    if (sub) targets.add(sub);
                }
                targets.delete(file.path);
                for (const target of targets) {
                    link(graph.out, file.path, target);
                    link(graph.in, target, file.path);
                }
                if (!targets.size && !module.startsWith('.')) external(file.path, module.split('.')[0] ?? module);
            }
            continue;
        }
        for (const pattern of patternsFor(file.path)) {
            pattern.lastIndex = 0;
            for (const match of file.text.matchAll(pattern)) {
                const specifier = match[1];
                if (!specifier) continue;
                const resolved = resolveImport(file.path, specifier, paths);
                if (resolved && resolved !== file.path) {
                    link(graph.out, file.path, resolved);
                    link(graph.in, resolved, file.path);
                } else if (!resolved && !specifier.startsWith('.')) {
                    external(file.path, packageNameOf(specifier));
                }
            }
        }
    }
    return graph;
}

/** Everything that (transitively) imports these files, nearest first. */
export function dependents(graph: ImportGraph, seeds: string[], maxDepth = 3, limit = 400): Map<string, number> {
    const found = new Map<string, number>();
    let frontier = [...new Set(seeds)];
    for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
        const next: string[] = [];
        for (const path of frontier) {
            for (const parent of graph.in.get(path) ?? []) {
                if (found.has(parent) || seeds.includes(parent)) continue;
                found.set(parent, depth);
                next.push(parent);
                if (found.size >= limit) return found;
            }
        }
        frontier = next;
    }
    return found;
}
