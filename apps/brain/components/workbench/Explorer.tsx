'use client';

import { roleOf, type FileRole } from '@agentic/project-brain';
import { memo, useEffect, useMemo, useState } from 'react';
import { Icon } from '../icons';
import { cx } from '../ui';

interface Node {
    name: string;
    path: string;
    dirs: Node[];
    files: string[];
    count: number;
}

function buildTree(paths: string[]): Node {
    const root: Node = { name: '', path: '', dirs: [], files: [], count: 0 };
    const index = new Map<string, Node>([['', root]]);
    for (const path of paths) {
        const parts = path.split('/');
        let node = root;
        node.count++;
        for (let i = 0; i < parts.length - 1; i++) {
            const dirPath = parts.slice(0, i + 1).join('/');
            let next = index.get(dirPath);
            if (!next) {
                next = { name: parts[i]!, path: dirPath, dirs: [], files: [], count: 0 };
                index.set(dirPath, next);
                node.dirs.push(next);
            }
            next.count++;
            node = next;
        }
        node.files.push(path);
    }
    const sort = (node: Node) => {
        node.dirs.sort((a, b) => a.name.localeCompare(b.name));
        node.files.sort((a, b) => a.localeCompare(b));
        node.dirs.forEach(sort);
    };
    sort(root);
    return root;
}

const ROLES: { role: FileRole; label: string }[] = [
    { role: 'api', label: 'API' },
    { role: 'component', label: 'Components' },
    { role: 'model', label: 'Models' },
    { role: 'service', label: 'Services' },
    { role: 'test', label: 'Tests' },
];
const DOT = new Set<FileRole>(ROLES.map((r) => r.role));

const Row = memo(function Row({ node, depth, active, forceOpen, onOpen }: { node: Node; depth: number; active?: string; forceOpen: boolean; onOpen: (path: string) => void }) {
    // Collapsed by default, like VS Code. Opening a file reveals it; the user can still collapse its folder.
    const [state, setState] = useState<'auto' | 'open' | 'closed'>('auto');
    const containsActive = !!active && active.startsWith(`${node.path}/`);
    useEffect(() => {
        if (containsActive) setState((s) => (s === 'closed' ? 'auto' : s));
    }, [active, containsActive]);
    const expanded = state === 'open' || (state === 'auto' && (containsActive || forceOpen));
    return (
        <li>
            <button
                type="button"
                onClick={() => setState(expanded ? 'closed' : 'open')}
                className="flex w-full items-center gap-1 py-0.75 pr-3 text-left text-[13px] text-fg hover:bg-panel-2"
                style={{ paddingLeft: depth * 12 + 8 }}
                aria-expanded={expanded}
            >
                <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={14} className="shrink-0 text-faint" />
                <Icon name="folder" size={14} className={cx('shrink-0', expanded ? 'text-accent' : 'text-faint')} />
                <span className="truncate">{node.name}</span>
                <span className="ml-auto pl-2 font-mono text-[11px] tabular-nums text-faint">{node.count}</span>
            </button>
            {expanded && (
                <ul>
                    {node.dirs.map((dir) => (
                        <Row key={dir.path} node={dir} depth={depth + 1} active={active} forceOpen={forceOpen} onOpen={onOpen} />
                    ))}
                    {node.files.map((path) => (
                        <FileRow key={path} path={path} depth={depth + 1} active={active === path} onOpen={onOpen} />
                    ))}
                </ul>
            )}
        </li>
    );
});

function FileRow({ path, depth, active, onOpen }: { path: string; depth: number; active: boolean; onOpen: (path: string) => void }) {
    const role = roleOf(path);
    const name = path.slice(path.lastIndexOf('/') + 1);
    return (
        <li>
            <button
                type="button"
                onClick={() => onOpen(path)}
                title={path}
                className={cx(
                    'flex w-full items-center gap-2 border-l-2 py-0.75 pr-3 text-left text-[13px]',
                    active ? 'border-accent bg-mark text-fg' : 'border-transparent text-muted hover:bg-panel-2 hover:text-fg',
                )}
                style={{ paddingLeft: depth * 12 + 26 }}
            >
                <span className={cx('size-1.5 shrink-0 rounded-full', DOT.has(role) ? `role-${role}` : 'bg-line-strong')} />
                <span className="truncate">{name}</span>
            </button>
        </li>
    );
}

export function Explorer({
    repo,
    paths,
    hidden,
    active,
    onOpen,
    onCollapse,
}: {
    repo: string;
    paths: string[];
    hidden: number;
    active?: string;
    onOpen: (path: string) => void;
    onCollapse: () => void;
}) {
    const [filter, setFilter] = useState('');
    const [role, setRole] = useState<FileRole>();

    const counts = useMemo(() => {
        const map = new Map<FileRole, number>();
        for (const path of paths) {
            const r = roleOf(path);
            map.set(r, (map.get(r) ?? 0) + 1);
        }
        return map;
    }, [paths]);

    const visible = useMemo(() => (role ? paths.filter((p) => roleOf(p) === role) : paths), [paths, role]);
    const tree = useMemo(() => buildTree(visible), [visible]);
    const matches = useMemo(() => {
        const needle = filter.trim().toLowerCase();
        return needle ? visible.filter((p) => p.toLowerCase().includes(needle)).slice(0, 200) : undefined;
    }, [filter, visible]);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-2 px-3 pb-1.5 pt-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">Explorer</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted" title={repo}>
                    {repo}
                </span>
                <button type="button" onClick={onCollapse} aria-label="Hide the side bar" title="Hide the side bar" className="rounded p-0.5 text-faint hover:bg-panel-2 hover:text-fg">
                    <Icon name="chevronRight" size={14} className="rotate-180" />
                </button>
            </div>

            <div className="px-3 pb-2">
                <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder={`Filter ${visible.length.toLocaleString()} files`}
                    aria-label="Filter files"
                    className="h-7 w-full rounded border border-line bg-bg px-2 text-[12px] text-fg placeholder:text-faint focus:border-accent focus:outline-none"
                />
                <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Show files by kind">
                    <button
                        type="button"
                        onClick={() => setRole(undefined)}
                        className={cx('rounded-full border px-2 py-0.5 text-[11px]', !role ? 'border-accent/60 bg-mark text-fg' : 'border-line text-muted hover:text-fg')}
                    >
                        All
                    </button>
                    {ROLES.filter((r) => (counts.get(r.role) ?? 0) > 0).map((r) => (
                        <button
                            key={r.role}
                            type="button"
                            onClick={() => setRole(role === r.role ? undefined : r.role)}
                            aria-pressed={role === r.role}
                            className={cx(
                                'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
                                role === r.role ? 'border-accent/60 bg-mark text-fg' : 'border-line text-muted hover:text-fg',
                            )}
                        >
                            <span className={`size-1.5 rounded-full role-${r.role}`} />
                            {r.label}
                            <span className="font-mono text-faint">{counts.get(r.role)}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto border-t border-line pb-3 pt-1">
                {matches ? (
                    <ul>
                        {matches.map((path) => (
                            <li key={path}>
                                <button type="button" onClick={() => onOpen(path)} className="block w-full truncate px-3 py-0.75 text-left font-mono text-[12px] text-muted hover:bg-panel-2 hover:text-fg" title={path}>
                                    {path}
                                </button>
                            </li>
                        ))}
                        {matches.length === 0 && <li className="px-3 py-2 text-[12px] text-faint">No file path contains that.</li>}
                    </ul>
                ) : (
                    <ul>
                        {tree.dirs.map((dir) => (
                            <Row key={`${role ?? 'all'}:${dir.path}`} node={dir} depth={0} active={active} forceOpen={!!role && visible.length <= 80} onOpen={onOpen} />
                        ))}
                        {tree.files.map((path) => (
                            <FileRow key={path} path={path} depth={-1} active={active === path} onOpen={onOpen} />
                        ))}
                    </ul>
                )}
                {hidden > 0 && !role && <p className="px-3 pt-3 text-[11px] leading-snug text-faint">{hidden.toLocaleString()} binaries, lock files and generated files are counted but not shown or read.</p>}
            </div>
        </div>
    );
}
