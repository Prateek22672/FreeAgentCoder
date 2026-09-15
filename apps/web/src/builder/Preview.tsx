import { SandpackPreview, SandpackProvider, useSandpack } from '@codesandbox/sandpack-react';
import type { MemoryWorkspace } from '@agentic/core';
import { useEffect, useMemo } from 'react';
import type { PreviewBridge } from '../lib/preview';
import { parseDependencies, PREVIEW_HIDDEN_FILES } from '../lib/template';

/** Pushes workspace edits into the running bundle and reports its errors back. */
function Bridge({ workspace, bridge }: { workspace: MemoryWorkspace; bridge: PreviewBridge }) {
  const { sandpack, listen } = useSandpack();

  useEffect(() => {
    return workspace.subscribe((change) => {
      if (change.type === 'write') sandpack.updateFile(change.path, workspace.snapshot()[change.path] ?? '');
      else if (change.type === 'delete') sandpack.deleteFile(change.path);
    });
  }, [workspace, sandpack]);

  useEffect(() => {
    return listen((raw) => {
      const msg = raw as unknown as Record<string, unknown>;
      const type = msg.type as string;
      if (type === 'start') bridge.compiling();
      else if (type === 'done') {
        bridge.compiled(null);
      } else if (type === 'action' && msg.action === 'show-error') {
        const err = { message: String(msg.message ?? msg.title ?? 'Error'), path: msg.path as string | undefined, line: msg.line as number | undefined };
        // Bundler errors also arrive as show-error; a compile failure has a path + no runtime marker.
        if (sandpack.status === 'running' && !msg.payload) bridge.runtimeError({ kind: 'runtime', ...err });
        else bridge.compiled({ kind: 'compile', ...err });
      } else if (type === 'console') {
        for (const log of (msg.log as { method: string; data: unknown[] }[]) ?? []) {
          if (log.method === 'error') bridge.runtimeError({ kind: 'runtime', message: log.data.map((d) => (typeof d === 'string' ? d : JSON.stringify(d))).join(' ').slice(0, 500) });
        }
      }
    });
  }, [listen, bridge, sandpack.status]);

  useEffect(() => {
    if (sandpack.error) {
      const e = sandpack.error as { message?: string; path?: string; line?: number };
      bridge.compiled({ kind: 'compile', message: e.message ?? 'Compile error', path: e.path, line: e.line });
    }
  }, [sandpack.error, bridge]);

  return null;
}

const PREVIEW_OPTIONS = {
  recompileMode: 'delayed' as const,
  recompileDelay: 400,
  autorun: true,
  autoReload: true,
  // Tailwind's browser build: every utility class works with no setup.
  externalResources: ['https://cdn.tailwindcss.com'],
};

export function Preview({ workspace, bridge, projectId }: { workspace: MemoryWorkspace; bridge: PreviewBridge; projectId: string }) {
  const packageJson = workspace.snapshot()['/package.json'];
  const depsKey = JSON.stringify(parseDependencies(packageJson));
  // Sandpack resets its files whenever `files` or `customSetup` change identity,
  // so both are memoized: they change only for a new project or new dependencies
  // (which remounts the preview). Every other edit flows through the Bridge.
  const initialFiles = useMemo(() => ({ ...PREVIEW_HIDDEN_FILES, ...workspace.snapshot() }), [projectId, depsKey, workspace]);
  const customSetup = useMemo(() => ({ entry: '/src/main.tsx', dependencies: JSON.parse(depsKey) as Record<string, string> }), [depsKey]);

  return (
    <div className="h-full w-full bg-white">
      <SandpackProvider
        key={`${projectId}:${depsKey}`}
        template="react-ts"
        theme="dark"
        files={initialFiles}
        customSetup={customSetup}
        options={PREVIEW_OPTIONS}
        style={{ height: '100%' }}
      >
        <Bridge workspace={workspace} bridge={bridge} />
        <SandpackPreview showOpenInCodeSandbox={false} showRefreshButton showRestartButton={false} style={{ height: '100%' }} />
      </SandpackProvider>
    </div>
  );
}
