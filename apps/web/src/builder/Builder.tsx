import { Download, FolderOpen, Plus, RotateCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, cx } from '../components/ui';
import { db, type ProjectRecord } from '../lib/db';
import { configuredProviders, modelChain, useSettings } from '../lib/settings';
import type { AgentSession } from '../lib/useAgentSession';
import { Chat } from './Chat';
import { Files } from './Files';
import { Preview } from './Preview';

async function downloadZip(name: string, files: Record<string, string>) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path.replace(/^\//, ''), content);
  zip.file('README.md', `# ${name}\n\nBuilt with Agentic. This is a Vite-style React + TypeScript project.\n\n\`\`\`\nnpm create vite@latest ${name.replace(/\s+/g, '-').toLowerCase()} -- --template react-ts\n# then copy src/ and the dependencies from package.json into it, and add Tailwind (https://tailwindcss.com/docs/installation/using-vite)\n\`\`\`\n`);
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^\w.-]+/g, '-') || 'agentic-app'}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function Builder({ s }: { s: AgentSession }) {
  const settings = useSettings();
  const [tab, setTab] = useState<'preview' | 'files'>('preview');
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [showProjects, setShowProjects] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const chain = modelChain(settings);
  const noProvider = configuredProviders(settings).length === 0;

  useEffect(() => {
    if (showProjects) void db.listProjects().then(setProjects);
  }, [showProjects]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <input
          value={s.project.name}
          onChange={(e) => s.rename(e.target.value)}
          className="w-48 rounded border border-transparent bg-transparent px-2 py-1 text-sm font-medium hover:border-zinc-700 focus:border-violet-500 focus:outline-none"
        />
        <div className="relative">
          <Button onClick={() => setShowProjects(!showProjects)} disabled={s.running}>
            <FolderOpen size={14} /> Projects
          </Button>
          {showProjects && (
            <div className="absolute left-0 top-9 z-20 w-72 rounded-md border border-zinc-700 bg-zinc-900 p-1 shadow-xl">
              {!projects.length && <div className="px-2 py-2 text-xs text-zinc-500">No saved projects yet.</div>}
              {projects.map((p) => (
                <button
                  key={p.id}
                  className={cx('block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-zinc-800', p.id === s.project.id && 'text-violet-300')}
                  onClick={() => {
                    void s.loadProject(p.id);
                    setShowProjects(false);
                  }}
                >
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="text-zinc-500">
                    {Object.keys(p.files).length} files · {new Date(p.updatedAt).toLocaleString()}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <Button onClick={s.newProject} disabled={s.running}>
          <Plus size={14} /> New
        </Button>
        <Button onClick={() => void downloadZip(s.project.name, s.session.workspace.snapshot())}>
          <Download size={14} /> Export
        </Button>
        <div className="ml-auto flex items-center gap-2 text-xs text-zinc-400">
          {chain.length ? (
            <>
              <Badge tone="violet">{chain[0]}</Badge>
              {chain.length > 1 && <span className="text-zinc-500">+{chain.length - 1} fallback{chain.length > 2 ? 's' : ''}</span>}
            </>
          ) : (
            <Badge tone="amber">no model configured</Badge>
          )}
          <Badge>{settings.mode}</Badge>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(340px,38%)_1fr]">
        <div className="min-h-0 border-r border-zinc-800">
          <Chat
            items={s.items}
            todos={s.todos}
            running={s.running}
            approval={s.approval}
            canUndo={s.session.agent.canUndo}
            disabledReason={noProvider ? 'Add a free API key in Admin → Providers to start building.' : undefined}
            onSend={(t) => void s.run(t)}
            onStop={s.stop}
            onUndo={() => void s.undo()}
          />
        </div>
        <div className="flex min-h-0 flex-col">
          <div className="flex items-center gap-1 border-b border-zinc-800 px-2 py-1">
            {(['preview', 'files'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cx('rounded px-2.5 py-1 text-xs capitalize', tab === t ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200')}>
                {t}
              </button>
            ))}
            <PreviewStatus bridge={s.bridge} />
            <Button variant="ghost" className="ml-auto" onClick={() => setPreviewKey((k) => k + 1)} title="Reload preview">
              <RotateCw size={13} />
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            {tab === 'preview' ? (
              <Preview key={previewKey} workspace={s.session.workspace} bridge={s.bridge} projectId={s.project.id} />
            ) : (
              <Files workspace={s.session.workspace} filesVersion={s.filesVersion} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewStatus({ bridge }: { bridge: AgentSession['bridge'] }) {
  const [, force] = useState(0);
  useEffect(() => bridge.subscribe(() => force((n) => n + 1)), [bridge]);
  const errors = bridge.errors;
  if (bridge.status === 'compiling') return <Badge tone="blue">compiling…</Badge>;
  if (errors.length) return <Badge tone="red">{errors.length} error{errors.length > 1 ? 's' : ''}</Badge>;
  if (bridge.status === 'ok') return <Badge tone="green">running</Badge>;
  return null;
}
