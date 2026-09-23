/**
 * What to keep out of a repository before anything looks at it.
 *
 * Pure on purpose: it takes paths and bytes, never a file system or a network,
 * so the same rules apply to a GitHub tarball on the server and a local folder
 * in the extension.
 */
import type { RepoFile, RepoInput, SkipCounts } from './types';

/** Directories whose contents tell you nothing about how a project is written. */
export const IGNORED_DIRS = new Set([
    '.git',
    '.hg',
    '.svn',
    'node_modules',
    'bower_components',
    'vendor',
    'dist',
    'build',
    'out',
    '.next',
    '.nuxt',
    '.svelte-kit',
    '.output',
    '.turbo',
    '.cache',
    '.parcel-cache',
    'coverage',
    '.nyc_output',
    '__pycache__',
    '.pytest_cache',
    '.mypy_cache',
    '.ruff_cache',
    '.tox',
    'venv',
    '.venv',
    'env',
    'site-packages',
    'target',
    'obj',
    'Pods',
    '.gradle',
    '.idea',
    '.vs',
    '.vscode-test',
    '.terraform',
    '.dart_tool',
    'DerivedData',
]);

/** Files that exist but whose content is noise for understanding a project. */
const GENERATED = [
    /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|composer\.lock|Gemfile\.lock|poetry\.lock|Cargo\.lock|go\.sum|pubspec\.lock)$/,
    /\.min\.(js|css)$/,
    /\.(map|lock)$/,
    /(^|\/)__snapshots__\//,
    /\.(pb|generated|g|gen)\.(ts|tsx|js|dart|go|py)$/,
    /(^|\/)(generated|__generated__)\//,
];

const BINARY_EXT = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'icns', 'tif', 'tiff', 'psd', 'svgz',
    'mp3', 'mp4', 'wav', 'ogg', 'webm', 'mov', 'avi', 'mkv', 'flac', 'm4a',
    'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'jar', 'war', 'apk', 'aab', 'ipa',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt',
    'woff', 'woff2', 'ttf', 'otf', 'eot',
    'so', 'dll', 'dylib', 'exe', 'bin', 'o', 'a', 'class', 'pyc', 'pyd', 'wasm',
    'db', 'sqlite', 'sqlite3', 'mdb',
    'pt', 'pth', 'onnx', 'safetensors', 'h5', 'pkl', 'npy', 'npz', 'parquet', 'arrow', 'bin',
]);

export const DEFAULT_LIMITS = {
    /** Per file: bigger files are listed but not read. */
    maxFileBytes: 512 * 1024,
    /** Total files whose text is read. */
    maxFiles: 4_000,
    /** Total text held in memory. */
    maxTotalBytes: 32 * 1024 * 1024,
};

export function extensionOf(path: string): string {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Is any segment of this path an ignored directory? */
export function inIgnoredDir(path: string): boolean {
    return path.split('/').slice(0, -1).some((segment) => IGNORED_DIRS.has(segment));
}

export function isGenerated(path: string): boolean {
    return GENERATED.some((re) => re.test(path));
}

/** Binary by extension. Content is checked separately, since extensions lie. */
export function isBinaryPath(path: string): boolean {
    return BINARY_EXT.has(extensionOf(path));
}

/** A NUL byte or a lot of control characters means this is not source code. */
export function looksBinary(bytes: Uint8Array): boolean {
    const sample = bytes.subarray(0, 4_096);
    let control = 0;
    for (const byte of sample) {
        if (byte === 0) return true;
        if (byte < 9 || (byte > 13 && byte < 32)) control++;
    }
    return sample.length > 0 && control / sample.length > 0.08;
}

/**
 * Whether a file's text should be read. Paths that fail this are still counted
 * and still appear in the tree — a lock file is evidence of a package manager
 * even though its content is useless.
 */
export function shouldReadContent(path: string, bytes: number, limits = DEFAULT_LIMITS): boolean {
    return !inIgnoredDir(path) && !isGenerated(path) && !isBinaryPath(path) && bytes <= limits.maxFileBytes;
}

export interface RawEntry {
    path: string;
    /** Size in bytes. Defaults to `bytes.length`. */
    size?: number;
    /**
     * Content, when it was kept. A streaming reader leaves this out for files
     * `shouldReadContent` rejects, so big binaries never reach memory.
     */
    bytes?: Uint8Array;
}

const decoder = new TextDecoder('utf-8', { fatal: false });

/**
 * Turn raw repository entries into the filtered set everything else works from.
 * Entries arrive in whatever order the archive had them; output is sorted so
 * analysis is deterministic.
 */
export function buildRepoInput(entries: RawEntry[], limits = DEFAULT_LIMITS): RepoInput {
    const skipped: SkipCounts = { ignoredDirs: 0, binary: 0, tooLarge: 0, generated: 0, overLimit: 0 };
    const paths: string[] = [];
    const files: RepoFile[] = [];
    let totalBytes = 0;

    for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
        if (inIgnoredDir(entry.path)) {
            skipped.ignoredDirs++;
            continue;
        }
        paths.push(entry.path);

        const size = entry.size ?? entry.bytes?.length ?? 0;
        if (isGenerated(entry.path)) {
            skipped.generated++;
            continue;
        }
        if (isBinaryPath(entry.path)) {
            skipped.binary++;
            continue;
        }
        if (size > limits.maxFileBytes) {
            skipped.tooLarge++;
            continue;
        }
        if (!entry.bytes || files.length >= limits.maxFiles || totalBytes + size > limits.maxTotalBytes) {
            skipped.overLimit++;
            continue;
        }
        if (looksBinary(entry.bytes)) {
            skipped.binary++;
            continue;
        }
        files.push({ path: entry.path, text: decoder.decode(entry.bytes), bytes: size });
        totalBytes += size;
    }

    return { paths, files, skipped };
}

/** The shape core's MemoryWorkspace and CodeIndex expect. */
export function toFileMap(files: RepoFile[]): Record<string, string> {
    const map: Record<string, string> = {};
    for (const file of files) map[file.path] = file.text;
    return map;
}
