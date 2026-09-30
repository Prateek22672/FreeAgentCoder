import { fail, isResponse, json, requireBrain } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * The ingested files of one analysis, shaped as the tree a browser-side
 * container mounts. Only files whose text was read are included — the same
 * set every other endpoint may serve — and a cap keeps a large repository from
 * turning into a multi-megabyte response the browser then has to hold twice.
 */
const MAX_TOTAL_CHARS = 6_000_000;
const MAX_FILE_CHARS = 400_000;

interface FileNode {
    file: { contents: string };
}
interface DirectoryNode {
    directory: Tree;
}
type Tree = Record<string, FileNode | DirectoryNode>;

function insert(tree: Tree, path: string, contents: string): void {
    const parts = path.split('/');
    let node = tree;
    for (const part of parts.slice(0, -1)) {
        const existing = node[part];
        if (existing && 'directory' in existing) {
            node = existing.directory;
        } else {
            const directory: Tree = {};
            node[part] = { directory };
            node = directory;
        }
    }
    node[parts[parts.length - 1]!] = { file: { contents } };
}

/** The script a project starts with, if it has one. */
function startScript(packageJson: string | undefined): { script: string; command: string } | undefined {
    if (!packageJson) return undefined;
    try {
        const scripts = (JSON.parse(packageJson) as { scripts?: Record<string, string> }).scripts ?? {};
        for (const script of ['dev', 'start', 'serve', 'preview']) {
            if (scripts[script]) return { script, command: scripts[script]! };
        }
    } catch {
        // not a readable package.json
    }
    return undefined;
}

export async function GET(request: Request) {
    const url = new URL(request.url);
    const brain = requireBrain(url.searchParams.get('id'));
    if (isResponse(brain)) return brain;

    const packageJson = brain.byPath.get('package.json')?.text;
    if (!packageJson) {
        return fail('Only JavaScript and TypeScript projects with a package.json at the root can run in the browser.', 422);
    }

    const tree: Tree = {};
    let total = 0;
    let skipped = 0;
    for (const file of brain.byPath.values()) {
        if (file.text.length > MAX_FILE_CHARS) {
            skipped += 1;
            continue;
        }
        if (total + file.text.length > MAX_TOTAL_CHARS) {
            skipped += 1;
            continue;
        }
        total += file.text.length;
        insert(tree, file.path, file.text);
    }
    return json({ files: tree, run: startScript(packageJson), skipped, chars: total });
}
