import { FREE_ORDER, PRESETS } from '@agentic/core';
import { CheckCircle2, ExternalLink, Eye, EyeOff, Loader2, Star, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, cx, fmtMs } from '../components/ui';
import { checkProvider, type ProviderCheck } from '../lib/session';
import { configuredProviders, maskKey, modelChain, updateSettings, useSettings } from '../lib/settings';

const ORDER = [...FREE_ORDER, 'anthropic', 'openai'];

function ProviderRow({ id }: { id: string }) {
  const preset = PRESETS[id]!;
  const settings = useSettings();
  const saved = settings.keys[id] ?? '';
  const [draft, setDraft] = useState('');
  const [show, setShow] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<ProviderCheck | null>(null);
  const [model, setModel] = useState(preset.defaultModel);
  const enabled = id === 'ollama' ? settings.ollama : !!saved;
  const isMain = settings.model.startsWith(`${id}:`);

  const test = async () => {
    setChecking(true);
    setCheck(await checkProvider(id));
    setChecking(false);
  };

  const save = async () => {
    const key = draft.trim();
    if (!key) return;
    updateSettings((s) => ({ keys: { ...s.keys, [id]: key }, model: s.model || `${id}:${preset.defaultModel}` }));
    setDraft('');
    setChecking(true);
    setCheck(await checkProvider(id));
    setChecking(false);
  };

  const models = [...new Set([...preset.models, ...(check?.models ?? []).filter((m) => !/embed|tts|audio|image|whisper|guard|moderation/i.test(m))])];

  return (
    <div className={cx('rounded-lg border p-4', enabled ? 'border-zinc-700 bg-zinc-900/70' : 'border-zinc-800 bg-zinc-900/30')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-zinc-100">{preset.label}</span>
        {preset.free ? <Badge tone="green">free</Badge> : <Badge tone="amber">paid · your key</Badge>}
        {enabled && <Badge tone="violet">configured</Badge>}
        {isMain && (
          <Badge tone="blue">
            <Star size={10} className="mr-1" /> main model
          </Badge>
        )}
        {preset.signupUrl && (
          <a href={preset.signupUrl} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 text-xs text-violet-300 hover:underline">
            Get a key <ExternalLink size={11} />
          </a>
        )}
      </div>
      <p className="mt-1 text-xs text-zinc-500">{preset.note}</p>

      {id === 'ollama' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={settings.ollama} onChange={(e) => updateSettings({ ollama: e.target.checked })} /> Use local Ollama
          </label>
          <input value={settings.ollamaUrl} onChange={(e) => updateSettings({ ollamaUrl: e.target.value })} className="w-64 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs" />
          <Button onClick={test} disabled={checking}>{checking ? <Loader2 size={12} className="animate-spin" /> : 'Test'}</Button>
          <span className="text-[11px] text-zinc-500">Start Ollama with OLLAMA_ORIGINS=* so the browser may call it.</span>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {saved && !draft ? (
            <code className="rounded bg-zinc-950 px-2 py-1 text-xs text-zinc-300">{show ? saved : maskKey(saved)}</code>
          ) : null}
          {saved && (
            <Button variant="ghost" onClick={() => setShow(!show)} title={show ? 'Hide' : 'Show'}>
              {show ? <EyeOff size={12} /> : <Eye size={12} />}
            </Button>
          )}
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
            placeholder={saved ? 'Paste a new key to replace' : `Paste your ${preset.label} API key`}
            className="min-w-56 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs"
            autoComplete="off"
          />
          <Button variant="primary" onClick={() => void save()} disabled={!draft.trim()}>Save & test</Button>
          {saved && <Button onClick={test} disabled={checking}>{checking ? <Loader2 size={12} className="animate-spin" /> : 'Test'}</Button>}
          {saved && (
            <Button
              variant="ghost"
              onClick={() =>
                updateSettings((s) => {
                  const keys = { ...s.keys };
                  delete keys[id];
                  return { keys, model: s.model.startsWith(`${id}:`) ? '' : s.model };
                })
              }
            >
              Remove
            </Button>
          )}
        </div>
      )}

      {check && (
        <div className={cx('mt-2 flex items-start gap-1.5 text-xs', check.ok ? 'text-emerald-300' : 'text-red-300')}>
          {check.ok ? <CheckCircle2 size={13} className="mt-px" /> : <XCircle size={13} className="mt-px" />}
          {check.ok ? `Working · ${check.models.length} models · ${fmtMs(check.ms)}` : <span className="break-all">Failed: {check.error}</span>}
        </div>
      )}

      {enabled && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-zinc-500">Model</span>
          <select value={model} onChange={(e) => setModel(e.target.value)} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1">
            {models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <Button onClick={() => updateSettings({ model: `${id}:${model}` })} disabled={settings.model === `${id}:${model}`}>
            <Star size={12} /> Make main model
          </Button>
        </div>
      )}
    </div>
  );
}

export function Providers() {
  const settings = useSettings();
  const chain = modelChain(settings);
  const configured = configuredProviders(settings);

  return (
    <div className="space-y-4 p-5">
      <div>
        <h1 className="text-lg font-semibold">Providers & keys</h1>
        <p className="text-xs text-zinc-500">
          Keys stay in this browser (localStorage) and are sent only to the provider they belong to. Add several free providers: when one hits a rate limit, the next takes over automatically. Paid providers are never used unless you make them the main model.
        </p>
      </div>
      <Card title="Active model chain">
        {chain.length ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {chain.map((ref, i) => (
              <span key={ref} className="flex items-center gap-2">
                <Badge tone={i === 0 ? 'violet' : 'zinc'}>{i === 0 ? `main · ${ref}` : ref}</Badge>
                {i < chain.length - 1 && <span className="text-zinc-600">→</span>}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-amber-200">No provider configured yet. Google Gemini is the best free place to start.</p>
        )}
        <p className="mt-2 text-[11px] text-zinc-500">{configured.length} provider{configured.length === 1 ? '' : 's'} configured. Requests too large for a free tier (e.g. Groq's 8K tokens/min) skip it automatically.</p>
      </Card>
      <div className="grid gap-3 xl:grid-cols-2">
        {ORDER.map((id) => (
          <ProviderRow key={id} id={id} />
        ))}
      </div>
    </div>
  );
}
