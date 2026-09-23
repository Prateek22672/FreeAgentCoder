/**
 * Read-only GitHub access. Nothing here runs repository code: source is
 * downloaded, filtered, and held as text in memory.
 *
 * GITHUB_TOKEN, when set, is read on the server only and never returned to a
 * client or written to a log.
 */
import 'server-only';
import { DEFAULT_LIMITS, inIgnoredDir, isBinaryPath, isGenerated, type RawEntry, type RepoMeta } from '@agentic/project-brain';
import { parseRepoSpec, type RepoSpec } from './repoSpec';
import { readTar } from './tar';

export class RepoError extends Error {
    constructor(
        message: string,
        readonly status = 400,
    ) {
        super(message);
    }
}

export function parseRepo(input: string): RepoSpec {
    const spec = parseRepoSpec(input);
    if ('error' in spec) throw new RepoError(spec.error);
    return spec;
}

function headers(): HeadersInit {
    const token = process.env.GITHUB_TOKEN;
    return {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'FreeAgentCoder-ProjectBrain',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}

/** Largest repository accepted, by GitHub's reported size (which includes history). */
const MAX_REPO_KB = 250_000;
/** Largest uncompressed archive read. */
const MAX_ARCHIVE_BYTES = 400 * 1024 * 1024;

export async function fetchMeta(owner: string, repo: string, ref?: string): Promise<RepoMeta & { sizeKb: number }> {
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers: headers(), cache: 'no-store' });
    if (response.status === 404) {
        throw new RepoError(`github.com/${owner}/${repo} doesn't exist, or it's private. Only public repositories can be analyzed without signing in.`, 404);
    }
    if (response.status === 403 || response.status === 429) {
        throw new RepoError("GitHub's rate limit for anonymous requests was reached. Try again in a few minutes, or set GITHUB_TOKEN.", 429);
    }
    if (!response.ok) throw new RepoError(`GitHub returned ${response.status}.`, 502);

    const data = (await response.json()) as {
        default_branch: string;
        description: string | null;
        stargazers_count: number;
        private: boolean;
        size: number;
        html_url: string;
    };
    // Anything but a repository object means the request went somewhere unexpected.
    if (typeof data.default_branch !== 'string' || typeof data.html_url !== 'string') throw new RepoError('GitHub did not return a repository.', 502);
    if (data.size > MAX_REPO_KB) {
        throw new RepoError(`This repository is about ${Math.round(data.size / 1024)} MB, over the ${MAX_REPO_KB / 1000} MB limit for now.`, 413);
    }
    return {
        owner,
        repo,
        ref: ref ?? data.default_branch,
        description: data.description ?? undefined,
        stars: data.stargazers_count,
        private: data.private,
        url: data.html_url,
        sizeKb: data.size,
    };
}

export type Progress = (event: { step: 'list' | 'download' | 'analyze' | 'index'; message: string; done?: number; total?: number }) => void;

const keepContent = (path: string, size: number) =>
    !inIgnoredDir(path) && !isGenerated(path) && !isBinaryPath(path) && size <= DEFAULT_LIMITS.maxFileBytes;

/**
 * How the source is downloaded. Both ways are measured to have slow outliers
 * (GitHub's archive server and its raw-file CDN each stall at times), so for an
 * ordinary repository both run at once and the first to finish wins. Past these
 * limits only one of them makes sense:
 *   - more than this many bytes we would throw away (images, video, datasets):
 *     the archive is skipped, since it would download all of it;
 *   - more than this many files: per-file downloads are skipped.
 */
const ARCHIVE_WASTE_LIMIT = 6 * 1024 * 1024;
const MAX_INDIVIDUAL_FILES = 1_500;
const PARALLEL_DOWNLOADS = 64;

interface TreeEntry {
    path: string;
    type: 'blob' | 'tree' | 'commit';
    size?: number;
}

interface Listing {
    blobs: TreeEntry[];
    wanted: TreeEntry[];
    wasted: number;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Every file with its size, in one API call. Undefined when GitHub truncates the tree. */
async function listFiles(owner: string, repo: string, ref: string): Promise<Listing | undefined> {
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`, {
        headers: headers(),
        cache: 'no-store',
    });
    if (!response.ok) return undefined;
    const data = (await response.json()) as { tree?: TreeEntry[]; truncated?: boolean };
    if (!data.tree || data.truncated) return undefined;
    const blobs = data.tree.filter((e) => e.type === 'blob');
    const wanted = blobs.filter((e) => keepContent(e.path, e.size ?? 0)).slice(0, DEFAULT_LIMITS.maxFiles);
    const wantedBytes = wanted.reduce((n, e) => n + (e.size ?? 0), 0);
    return { blobs, wanted, wasted: blobs.reduce((n, e) => n + (e.size ?? 0), 0) - wantedBytes };
}

/** Only the text files, from GitHub's raw CDN, in parallel. */
async function fetchFiles(owner: string, repo: string, ref: string, listing: Listing, signal: AbortSignal, progress?: Progress): Promise<RawEntry[]> {
    const base = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${ref.split('/').map(encodeURIComponent).join('/')}`;
    const contents = new Map<string, Uint8Array>();
    const { wanted } = listing;
    let next = 0;
    let done = 0;
    let failed = 0;
    const worker = async () => {
        while (next < wanted.length && !signal.aborted) {
            const entry = wanted[next++]!;
            try {
                const file = await fetch(`${base}/${entry.path.split('/').map(encodeURIComponent).join('/')}`, {
                    headers: { 'User-Agent': 'FreeAgentCoder-ProjectBrain' },
                    cache: 'no-store',
                    signal,
                });
                if (file.ok) contents.set(entry.path, new Uint8Array(await file.arrayBuffer()));
                else failed++;
            } catch {
                if (signal.aborted) return;
                failed++;
            }
            done++;
            if (done % 25 === 0 || done === wanted.length) progress?.({ step: 'download', message: 'Downloading source files', done, total: wanted.length });
        }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_DOWNLOADS, wanted.length) }, worker));
    if (signal.aborted) throw new Error('cancelled');
    // Many failures means the CDN is unhappy; let the archive (or an error) win.
    if (failed > Math.max(5, wanted.length * 0.05)) throw new RepoError(`Downloading ${failed} files failed.`, 502);
    return listing.blobs.map((e) => ({ path: e.path, size: e.size ?? 0, bytes: contents.get(e.path) }));
}

/** The whole repository as one archive, filtered while it streams. */
async function fetchArchive(owner: string, repo: string, ref: string, signal?: AbortSignal): Promise<RawEntry[]> {
    const response = await fetch(`https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tar.gz/${encodeURIComponent(ref)}`, {
        headers: { 'User-Agent': 'FreeAgentCoder-ProjectBrain' },
        cache: 'no-store',
        signal,
    });
    if (response.status === 404) throw new RepoError(`Couldn't find branch "${ref}".`, 404);
    if (!response.ok || !response.body) throw new RepoError(`Downloading the repository failed (${response.status}).`, 502);
    return readTar(response.body.pipeThrough(new DecompressionStream('gzip')) as ReadableStream<Uint8Array>, {
        keep: keepContent,
        stripFirst: true,
        maxBytes: MAX_ARCHIVE_BYTES,
    });
}

/** Download and filter the repository at `ref`. Only text we will analyze is kept. */
export async function fetchEntries(owner: string, repo: string, ref: string, progress?: Progress): Promise<RawEntry[]> {
    progress?.({ step: 'list', message: 'Listing files' });
    const listing = await listFiles(owner, repo, ref).catch(() => undefined);
    if (!listing) {
        progress?.({ step: 'download', message: 'Downloading the source archive' });
        return fetchArchive(owner, repo, ref);
    }

    const { blobs, wanted, wasted } = listing;
    const skipped = blobs.length - wanted.length;
    progress?.({
        step: 'list',
        message: `${blobs.length.toLocaleString()} files · reading ${wanted.length.toLocaleString()}${skipped ? ` · skipping ${skipped.toLocaleString()} binaries, dependencies and generated files` : ''}${wasted > ARCHIVE_WASTE_LIMIT ? ` (${formatBytes(wasted)} never downloaded)` : ''}`,
    });

    const perFile = wanted.length <= MAX_INDIVIDUAL_FILES;
    const archive = wasted <= ARCHIVE_WASTE_LIMIT || !perFile;
    if (!perFile) {
        progress?.({ step: 'download', message: 'Downloading the source archive' });
        return fetchArchive(owner, repo, ref);
    }
    const filesAbort = new AbortController();
    if (!archive) return fetchFiles(owner, repo, ref, listing, filesAbort.signal, progress);

    // Race: whichever finishes first wins, and the other is cancelled.
    const archiveAbort = new AbortController();
    const viaArchive = fetchArchive(owner, repo, ref, archiveAbort.signal).then((entries) => {
        filesAbort.abort();
        return entries;
    });
    const viaFiles = fetchFiles(owner, repo, ref, listing, filesAbort.signal, progress).then((entries) => {
        archiveAbort.abort();
        return entries;
    });
    try {
        return await Promise.any([viaArchive, viaFiles]);
    } catch (error) {
        // Both failed: report the archive's reason, which is the more specific one.
        const reasons = (error as AggregateError).errors ?? [];
        throw reasons.find((e: unknown) => e instanceof RepoError) ?? new RepoError('Downloading the repository failed.', 502);
    }
}
