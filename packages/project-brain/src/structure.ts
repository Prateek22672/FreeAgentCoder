/**
 * What each file is for, what the folder tree looks like, and which layers the
 * project actually has. Roles drive both the dashboard counts and the grouping
 * in impact analysis, so they are computed once here.
 */
import { extensionOf } from './ingest';
import type { ArchitectureLayer, FileRole, RepoFile, RepoInput, RoleCounts, TreeNode } from './types';

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|e2e|fixtures?|__mocks__)\//i;
/** Example and demo code: part of the repository, not part of the product. */
const EXAMPLE_PATH = /(^|\/)(examples?|demos?|samples?|playground|sandbox)\//i;
const UI_EXT = /^(tsx|jsx|vue|svelte|astro)$/;
const NEXT_UI_FILE = /^(page|layout|loading|error|template|not-found|default|global-error)\.(tsx|jsx)$/;
const CONFIG_EXT = new Set(['json', 'jsonc', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'xml', 'properties', 'env', 'lock']);
const ASSET_EXT = new Set(['svg', 'html', 'htm', 'ejs', 'hbs', 'pug', 'njk', 'liquid']);
const TEST_FILE = /\.(test|spec)\.[jt]sx?$|_test\.(go|py|rb)$|^test_.*\.py$|Test\.(java|kt|cs)$|_spec\.rb$/i;
const CONFIG_FILE = /^(package|tsconfig|jsconfig|vercel|turbo|nx|angular|nest-cli|composer)\.json$|\.(config|conf)\.[jt]s$|^(Dockerfile|Makefile|docker-compose\.ya?ml|\.env\.example|.*\.toml|.*\.ini|.*\.cfg)$|^\..*rc(\.[a-z]+)?$/i;
const DOC_EXT = new Set(['md', 'mdx', 'rst', 'adoc', 'txt']);
const STYLE_EXT = new Set(['css', 'scss', 'sass', 'less', 'styl']);

/** Next.js app/pages routes, REST-ish folders, and controller files. */
const API_PATH = /(^|\/)(app|src\/app)\/.*\/route\.[jt]s$|(^|\/)pages\/api\/|(^|\/)(api|routes|endpoints|controllers|handlers)\//i;
const API_FILE = /\.(controller|router|route|handler|resolver)\.[jt]s$|(^|\/)urls\.py$|(^|\/)views\.py$/i;
const COMPONENT_PATH = /(^|\/)(components?|widgets?|ui|views|screens|pages)\//i;
const MODEL_PATH = /(^|\/)(models?|entities|schemas?|domain|migrations)\//i;
const MODEL_FILE = /\.(model|entity|schema)\.[jt]s$|schema\.prisma$|(^|\/)models\.py$/i;
const SERVICE_PATH = /(^|\/)(services?|lib|core|usecases?|repositories|providers|store|hooks|utils?|helpers)\//i;
const SERVICE_FILE = /\.(service|repository|usecase|provider|store)\.[jt]s$/i;

const CODE_EXT = new Set([
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'vue', 'svelte', 'astro',
    'py', 'go', 'rs', 'rb', 'php', 'java', 'kt', 'scala', 'cs', 'swift', 'dart',
    'c', 'cpp', 'cc', 'h', 'hpp', 'ex', 'exs', 'sql',
]);

export function isCodeFile(path: string): boolean {
    return CODE_EXT.has(extensionOf(path));
}

/** One role per file, most specific first — a test of a controller is a test. */
export function roleOf(path: string): FileRole {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const ext = extensionOf(path);
    if (TEST_FILE.test(name) || TEST_PATH.test(path)) return 'test';
    if (EXAMPLE_PATH.test(path)) return 'example';
    if (DOC_EXT.has(ext)) return 'doc';
    if (STYLE_EXT.has(ext)) return 'style';
    if (CONFIG_FILE.test(name) || CONFIG_EXT.has(ext)) return 'config';
    const ui = UI_EXT.test(ext);
    // Next.js app router: page.tsx, layout.tsx and friends are UI; route.ts is API.
    if (ui && NEXT_UI_FILE.test(name) && /(^|\/)app\//.test(path)) return 'component';
    // A "routes/" folder of .tsx files is a front-end router's pages, not an API.
    if ((API_PATH.test(path) && !ui) || API_FILE.test(name)) return 'api';
    if (API_PATH.test(path) && ui) return 'component';
    if (MODEL_PATH.test(path) || MODEL_FILE.test(name)) return 'model';
    if (COMPONENT_PATH.test(path) && /^(tsx|jsx|vue|svelte|astro)$/.test(ext)) return 'component';
    if (SERVICE_PATH.test(path) || SERVICE_FILE.test(name)) return 'service';
    // Templates and markup inside a views/components folder are UI too.
    if (COMPONENT_PATH.test(path) && (isCodeFile(path) || ASSET_EXT.has(ext))) return 'component';
    if (ASSET_EXT.has(ext)) return 'style';
    return 'other';
}

export function classifyAll(paths: string[]): Map<string, FileRole> {
    return new Map(paths.map((path) => [path, roleOf(path)]));
}

export const FILE_ROLES: FileRole[] = ['api', 'component', 'model', 'service', 'test', 'example', 'config', 'doc', 'style', 'other'];

export function countRoles(roles: Map<string, FileRole>): RoleCounts {
    const counts = Object.fromEntries(FILE_ROLES.map((r) => [r, 0])) as RoleCounts;
    for (const role of roles.values()) counts[role]++;
    return counts;
}

export function groupByRole(roles: Map<string, FileRole>, limit = 200): Record<FileRole, string[]> {
    const groups = Object.fromEntries(FILE_ROLES.map((r) => [r, [] as string[]])) as Record<FileRole, string[]>;
    for (const [path, role] of roles) {
        if (groups[role].length < limit) groups[role].push(path);
    }
    return groups;
}

/**
 * A tree that stays readable: folders are listed with their file counts, and
 * anything past `maxChildren` per level is summarized rather than dumped.
 */
export function buildTree(paths: string[], opts: { maxDepth?: number; maxChildren?: number } = {}): TreeNode {
    const maxDepth = opts.maxDepth ?? 3;
    const maxChildren = opts.maxChildren ?? 12;
    const root: TreeNode = { name: '/', path: '', files: 0, children: [] };

    const ensure = (parent: TreeNode, name: string): TreeNode => {
        let child = parent.children.find((c) => c.name === name);
        if (!child) {
            child = { name, path: parent.path ? `${parent.path}/${name}` : name, files: 0, children: [] };
            parent.children.push(child);
        }
        return child;
    };

    for (const path of paths) {
        const segments = path.split('/');
        let node = root;
        node.files++;
        for (const segment of segments.slice(0, -1)) {
            node = ensure(node, segment);
            node.files++;
        }
    }

    const prune = (node: TreeNode, depth: number): void => {
        node.children.sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));
        if (depth >= maxDepth) {
            if (node.children.length) node.collapsed = node.children.length;
            node.children = [];
            return;
        }
        if (node.children.length > maxChildren) {
            node.collapsed = node.children.length - maxChildren;
            node.children = node.children.slice(0, maxChildren);
        }
        for (const child of node.children) prune(child, depth + 1);
    };
    prune(root, 0);
    return root;
}

/** Only layers with files in them, so the diagram reflects the repository. */
export function buildArchitecture(roles: Map<string, FileRole>): ArchitectureLayer[] {
    const order: { id: FileRole; label: string }[] = [
        { id: 'component', label: 'UI / Components' },
        { id: 'api', label: 'API / Routes' },
        { id: 'service', label: 'Services / Logic' },
        { id: 'model', label: 'Data / Models' },
        { id: 'test', label: 'Tests' },
    ];
    // Package markers and barrel files say nothing about what a layer does.
    const boring = (path: string) => /(^|\/)(__init__\.py|index\.[jt]sx?|mod\.rs|\.gitkeep)$/.test(path);
    const layers: ArchitectureLayer[] = [];
    for (const { id, label } of order) {
        const files = [...roles].filter(([, role]) => role === id).map(([path]) => path);
        if (files.length) {
            const examples = [...files.filter((p) => !boring(p)), ...files.filter(boring)].slice(0, 3);
            layers.push({ id, label, files: files.length, examples });
        }
    }
    return layers;
}

/** Entry points worth reading first, ranked by how central they look. */
export function entryPoints(files: RepoFile[]): string[] {
    const candidates = [
        /^(src\/)?(main|index|app)\.[jt]sx?$/,
        /^(src\/)?app\/(layout|page)\.tsx$/,
        /^(src\/)?server\.[jt]s$/,
        /^main\.py$|^app\.py$|^manage\.py$|^__main__\.py$/,
        /^cmd\/[^/]+\/main\.go$|^main\.go$/,
        /^src\/main\.rs$/,
        /^lib\/main\.dart$/,
    ];
    return files
        .map((f) => f.path)
        .filter((path) => candidates.some((re) => re.test(path)))
        .slice(0, 8);
}

export function summarize(input: RepoInput): { roles: Map<string, FileRole>; counts: RoleCounts; tree: TreeNode; architecture: ArchitectureLayer[] } {
    const roles = classifyAll(input.paths);
    return { roles, counts: countRoles(roles), tree: buildTree(input.paths), architecture: buildArchitecture(roles) };
}
