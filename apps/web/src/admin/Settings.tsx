import { PERMISSION_MODES } from '@agentic/core';
import { Button, Card } from '../components/ui';
import { db, notifyRunsChanged } from '../lib/db';
import { updateSettings, useSettings, type Settings as SettingsT } from '../lib/settings';

const MODE_HELP: Record<string, string> = {
  ask: 'Every file change needs your approval.',
  'auto-edit': 'File changes are applied automatically (you can always Undo).',
  auto: 'Everything runs automatically.',
};

export function Settings() {
  const s = useSettings();
  return (
    <div className="max-w-3xl space-y-4 p-5">
      <h1 className="text-lg font-semibold">Settings</h1>

      <Card title="Agent">
        <div className="space-y-4 text-sm">
          <div>
            <div className="mb-1 text-xs text-zinc-400">Permission mode</div>
            <div className="flex gap-2">
              {PERMISSION_MODES.map((m) => (
                <Button key={m} variant={s.mode === m ? 'primary' : 'outline'} onClick={() => updateSettings({ mode: m })}>
                  {m}
                </Button>
              ))}
            </div>
            <p className="mt-1 text-xs text-zinc-500">{MODE_HELP[s.mode]}</p>
          </div>
          <label className="block">
            <div className="mb-1 text-xs text-zinc-400">Compact the conversation beyond (tokens)</div>
            <input type="number" min={8000} step={4000} value={s.maxContextTokens} onChange={(e) => updateSettings({ maxContextTokens: Number(e.target.value) || 60_000 })} className="w-40 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs" />
            <p className="mt-1 text-xs text-zinc-500">Lower keeps free quotas lasting longer and weaker models sharper; higher keeps more history verbatim.</p>
          </label>
          <label className="block">
            <div className="mb-1 text-xs text-zinc-400">Claude reasoning effort (Anthropic only)</div>
            <select value={s.effort} onChange={(e) => updateSettings({ effort: e.target.value as SettingsT['effort'] })} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs">
              {['low', 'medium', 'high', 'xhigh', 'max'].map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <Card title="Connection (relay)">
        <div className="space-y-3 text-sm">
          <p className="text-xs text-zinc-500">
            Some providers (Groq, Cerebras, Mistral) block direct browser calls. In development the Vite server relays them for you. For a deployed site, deploy <code>apps/relay</code> (a free Cloudflare Worker) and paste its URL here. Keys pass through it; it stores nothing.
          </p>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={s.useDevRelay} onChange={(e) => updateSettings({ useDevRelay: e.target.checked })} /> Use the dev-server relay (npm run web)
          </label>
          <input value={s.relayUrl} onChange={(e) => updateSettings({ relayUrl: e.target.value })} placeholder="https://agentic-relay.<you>.workers.dev" className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs" />
        </div>
      </Card>

      <Card title="Data">
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              const blob = new Blob([JSON.stringify({ ...s, keys: {} }, null, 2)], { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'agentic-settings.json';
              a.click();
            }}
          >
            Export settings (without keys)
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (!confirm('Delete all API keys, projects and run history from this browser?')) return;
              localStorage.removeItem('agentic.settings.v1');
              await db.clearRuns();
              for (const p of await db.listProjects()) await db.deleteProject(p.id);
              notifyRunsChanged();
              location.reload();
            }}
          >
            Delete everything
          </Button>
        </div>
      </Card>
    </div>
  );
}
