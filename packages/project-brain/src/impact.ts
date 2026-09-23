/**
 * Impact analysis: "what would this change touch?"
 *
 * Three tiers of certainty, kept apart in the output because they are not
 * equally trustworthy:
 *   direct     — files that literally contain the thing being changed
 *   dependents — files that import those, from the import graph
 *   estimate   — the totals and the risk level, which are heuristics
 */
import { buildImportGraph, dependents, type ImportGraph } from './imports';
import { roleOf } from './structure';
import type { Confidence, DependencyInfo, FileRole, RepoFile, RepoInput } from './types';

export interface ImpactRequest {
    query: string;
    input: RepoInput;
    graph?: ImportGraph;
    dependencies?: DependencyInfo[];
    /** Extra seeds, e.g. the top hits from the code index. */
    searchHits?: string[];
    /**
     * "What depends on this file?": start from exactly these files and skip the
     * word matching, which would read "lib/db.ts" as the words "lib" and "db".
     */
    files?: string[];
    maxDepth?: number;
}

export interface ImpactGroup {
    role: FileRole;
    label: string;
    files: string[];
}

export interface ImpactResult {
    query: string;
    terms: string[];
    direct: string[];
    dependents: { path: string; depth: number }[];
    groups: ImpactGroup[];
    externalPackages: { name: string; files: number }[];
    areas: { name: string; files: number }[];
    total: number;
    risk: 'low' | 'medium' | 'high';
    riskReason: string;
    confidence: Record<'direct' | 'dependents' | 'total', Confidence>;
    /** Set when nothing in the repository matched, so the UI can say so plainly. */
    empty?: boolean;
}

const STOP = new Set([
    'the', 'a', 'an', 'to', 'from', 'with', 'into', 'for', 'of', 'and', 'or', 'in', 'on', 'at', 'by',
    'replace', 'change', 'rename', 'remove', 'delete', 'add', 'move', 'update', 'migrate', 'switch',
    'refactor', 'convert', 'introduce', 'use', 'using', 'our', 'my', 'all', 'new', 'old', 'what',
    'happens', 'if', 'i', 'we', 'would', 'should', 'system', 'code', 'file', 'files', 'project',
]);

/** Words worth searching for: identifiers, dotted names, CamelCase, known packages. */
export function extractTerms(query: string): string[] {
    const raw = query.match(/[A-Za-z_][A-Za-z0-9_.@/-]*/g) ?? [];
    const terms = new Set<string>();
    for (const word of raw) {
        const lower = word.toLowerCase();
        if (word.length < 3 || STOP.has(lower)) continue;
        terms.add(word);
        // "User.email" also means "User" and "email"; "UserService" also means "user".
        for (const part of word.split(/[._/-]/)) {
            if (part.length >= 3 && !STOP.has(part.toLowerCase())) terms.add(part);
        }
    }
    return [...terms].slice(0, 12);
}

function matchesTerm(file: RepoFile, terms: string[]): boolean {
    const haystack = `${file.path}\n${file.text}`;
    return terms.some((term) => {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack);
    });
}

const ROLE_LABELS: Record<FileRole, string> = {
    api: 'API routes',
    component: 'Components',
    model: 'Models & schemas',
    service: 'Services & logic',
    test: 'Tests',
    example: 'Examples',
    config: 'Configuration',
    doc: 'Documentation',
    style: 'Styles & assets',
    other: 'Other code',
};

export function analyzeImpact(request: ImpactRequest): ImpactResult {
    const { query, input } = request;
    const terms = request.files?.length ? [] : extractTerms(query);
    const graph = request.graph ?? buildImportGraph(input.files);

    // 1. Direct hits: the files that actually mention it.
    const direct = new Set<string>(request.files?.length ? request.files : (request.searchHits ?? []));
    if (terms.length) {
        for (const file of input.files) {
            if (direct.size >= 300) break;
            if (matchesTerm(file, terms)) direct.add(file.path);
        }
    }

    // A named package pulls in everything importing it — including its scoped
    // runtime ("Prisma" means @prisma/client, which is what code imports).
    const externalPackages: { name: string; files: number }[] = [];
    const lowerTerms = terms.map((t) => t.toLowerCase());
    const namesPackage = (pkg: string) => {
        const name = pkg.toLowerCase();
        // Exact name or its scope only: a suffix match would let "client" pull in @apollo/client.
        return lowerTerms.some((t) => name === t || name.startsWith(`@${t}/`));
    };
    for (const [pkg, importers] of graph.byPackage) {
        if (!namesPackage(pkg) || !importers.size) continue;
        externalPackages.push({ name: pkg, files: importers.size });
        for (const path of importers) direct.add(path);
    }
    // Named in a manifest but imported nowhere: a CLI or build tool. Still worth listing.
    for (const dep of request.dependencies ?? []) {
        if (namesPackage(dep.name) && !externalPackages.some((p) => p.name === dep.name)) externalPackages.push({ name: dep.name, files: 0 });
    }
    externalPackages.sort((a, b) => b.files - a.files);

    // 2. Everything that imports those files.
    const reverse = dependents(graph, [...direct], request.maxDepth ?? 3);

    const all = new Map<string, FileRole>();
    for (const path of direct) all.set(path, roleOf(path));
    for (const path of reverse.keys()) all.set(path, roleOf(path));

    const groups: ImpactGroup[] = [];
    // Every role, so the groups always add up to the total.
    for (const role of ['api', 'model', 'service', 'component', 'other', 'test', 'example', 'config', 'doc', 'style'] as FileRole[]) {
        const files = [...all].filter(([, r]) => r === role).map(([path]) => path);
        if (files.length) groups.push({ role, label: ROLE_LABELS[role], files: files.sort() });
    }

    const areaCounts = new Map<string, number>();
    for (const path of all.keys()) {
        // An area is a folder, up to two levels deep: "app/api", "lib", or the root.
        const folders = path.split('/').slice(0, -1);
        const area = folders.length ? folders.slice(0, 2).join('/') : '(root)';
        areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);
    }
    const areas = [...areaCounts]
        .map(([name, files]) => ({ name, files }))
        .sort((a, b) => b.files - a.files)
        .slice(0, 6);

    const total = all.size;
    const touchesData = groups.some((g) => g.role === 'model');
    const touchesApi = groups.some((g) => g.role === 'api');
    const spread = groups.filter((g) => !['test', 'doc', 'example', 'style', 'config'].includes(g.role)).length;

    let risk: ImpactResult['risk'] = 'low';
    let riskReason = 'A small number of files, in one area.';
    if (total > 40 || (touchesData && touchesApi && spread >= 3)) {
        risk = 'high';
        riskReason = touchesData && touchesApi
            ? 'It reaches both the data layer and the API, so behaviour can break in several places at once.'
            : `About ${total} files across ${spread} kinds of code.`;
    } else if (total > 12 || spread >= 3) {
        risk = 'medium';
        riskReason = `About ${total} files across ${spread} kinds of code.`;
    }

    return {
        query,
        terms,
        direct: [...direct].sort(),
        dependents: [...reverse].map(([path, depth]) => ({ path, depth })).sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path)),
        groups,
        externalPackages,
        areas,
        total,
        risk,
        riskReason,
        confidence: { direct: 'detected', dependents: 'inferred', total: 'estimated' },
        ...(total === 0 ? { empty: true } : {}),
    };
}
