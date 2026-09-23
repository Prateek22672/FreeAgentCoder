/**
 * The Project Brain data model.
 *
 * Every claim carries how it was arrived at, because a wrong guess presented as
 * fact is worse than no answer:
 *   detected  — read straight out of the repository (a dependency in package.json)
 *   inferred  — deduced from strong signals (a Next.js app router from its folders)
 *   estimated — a heuristic count that may be off (how many files a change touches)
 */
export type Confidence = 'detected' | 'inferred' | 'estimated';

/** A claim plus the files that back it. */
export interface Finding<T = string> {
    value: T;
    confidence: Confidence;
    /** Repository paths a human can open to check the claim. */
    evidence: string[];
    note?: string;
}

/** A text file whose content was ingested. */
export interface RepoFile {
    path: string;
    text: string;
    bytes: number;
}

/** What a repository looked like when it was ingested. */
export interface RepoInput {
    /** Every path in the repository after ignored directories were dropped. */
    paths: string[];
    /** The subset whose text was read (see `shouldReadContent`). */
    files: RepoFile[];
    skipped: SkipCounts;
}

export interface SkipCounts {
    ignoredDirs: number;
    binary: number;
    tooLarge: number;
    generated: number;
    overLimit: number;
}

export interface RepoMeta {
    owner: string;
    repo: string;
    ref: string;
    description?: string;
    stars?: number;
    private?: boolean;
    url: string;
}

export interface LanguageStat {
    name: string;
    files: number;
    bytes: number;
    /** 0-1 share of the code by bytes. */
    share: number;
}

export interface DependencyInfo {
    name: string;
    version: string;
    kind: 'prod' | 'dev';
    ecosystem: string;
    /** The manifest it was read from, e.g. "backend/pyproject.toml". */
    source?: string;
}

export interface TreeNode {
    name: string;
    path: string;
    files: number;
    children: TreeNode[];
    /** Set when the folder was summarized instead of listed. */
    collapsed?: number;
}

/** How a file is used in the project, for grouping and impact analysis. */
export type FileRole = 'api' | 'component' | 'model' | 'service' | 'test' | 'example' | 'config' | 'doc' | 'style' | 'other';

export type RoleCounts = Record<FileRole, number>;

export interface Analysis {
    meta: RepoMeta;
    fileCount: number;
    readCount: number;
    totalBytes: number;
    skipped: SkipCounts;
    languages: LanguageStat[];
    frameworks: Finding[];
    packageManager?: Finding;
    databases: Finding[];
    testing: Finding[];
    importantFiles: string[];
    dependencies: DependencyInfo[];
    tree: TreeNode;
    roles: RoleCounts;
    /** Files by role, capped for display. */
    byRole: Record<FileRole, string[]>;
    /** A layered view of the codebase, only for layers that were actually found. */
    architecture: ArchitectureLayer[];
}

export interface ArchitectureLayer {
    id: string;
    label: string;
    files: number;
    examples: string[];
}
