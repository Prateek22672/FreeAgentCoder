import type { MemoryWorkspace } from '@agentic/core';
import { ChevronDown, ChevronRight, FileCode2, Folder } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cx } from '../components/ui';

interface Node {
  name: string;
  path: string;
  children?: Node[];
}

function buildTree(paths: string[]): Node[] {
  const root: Node = { name: '', path: '/', children: [] };
  for (const p of paths.sort()) {
    const parts = p.split('/').filter(Boolean);
    let node = root;
    let acc = '';
    parts.forEach((part, i) => {
      acc += `/${part}`;
      let child = node.children!.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path: acc, ...(i < parts.length - 1 ? { children: [] } : {}) };
        node.children!.push(child);
      }
      node = child;
    });
  }
  const sort = (nodes: Node[]) => {
    nodes.sort((a, b) => (!!a.children === !!b.children ? a.name.localeCompare(b.name) : a.children ? -1 : 1));
    for (const n of nodes) if (n.children) sort(n.children);
  };
  sort(root.children!);
  return root.children!;
}

function TreeNode({ node, depth, selected, onSelect }: { node: Node; depth: number; selected: string; onSelect: (p: string) => void }) {
  const [open, setOpen] = useState(true);
  if (node.children) {
    return (
      <div>
        <button className="flex w-full items-center gap-1 px-2 py-0.5 text-left text-xs text-zinc-400 hover:bg-zinc-800" style={{ paddingLeft: depth * 12 + 8 }} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Folder size={12} className="text-zinc-500" /> {node.name}
        </button>
        {open && node.children.map((c) => <TreeNode key={c.path} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} />)}
      </div>
    );
  }
  return (
    <button
      className={cx('flex w-full items-center gap-1.5 px-2 py-0.5 text-left text-xs hover:bg-zinc-800', selected === node.path ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300')}
      style={{ paddingLeft: depth * 12 + 22 }}
      onClick={() => onSelect(node.path)}
    >
      <FileCode2 size={12} className="text-sky-400" /> {node.name}
    </button>
  );
}

export function Files({ workspace, filesVersion }: { workspace: MemoryWorkspace; filesVersion: number }) {
  const snapshot = useMemo(() => workspace.snapshot(), [workspace, filesVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const tree = useMemo(() => buildTree(Object.keys(snapshot)), [snapshot]);
  const [selected, setSelected] = useState('/src/App.tsx');
  const content = snapshot[selected] ?? snapshot[Object.keys(snapshot)[0] ?? ''] ?? '';
  const lines = content.split('\n');

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-52 shrink-0 overflow-auto border-r border-zinc-800 py-1">
        {tree.map((n) => (
          <TreeNode key={n.path} node={n} depth={0} selected={selected} onSelect={setSelected} />
        ))}
      </aside>
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="sticky top-0 border-b border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-400">{selected}</div>
        <pre className="p-3 font-mono text-[12px] leading-5 text-zinc-200">
          {lines.map((l, i) => (
            <div key={i} className="flex">
              <span className="w-10 shrink-0 select-none pr-3 text-right text-zinc-600">{i + 1}</span>
              <span className="whitespace-pre">{l}</span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
