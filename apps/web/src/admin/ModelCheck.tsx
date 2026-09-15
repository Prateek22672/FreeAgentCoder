import {
  Agent,
  fileTools,
  MemoryWorkspace,
  ModelRouter,
  parseModelRef,
  PermissionPolicy,
  PRESETS,
  type CallRecord,
} from '@agentic/core';
import { CheckCircle2, Loader2, Play, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, cx, fmtMs, fmtTokens } from '../components/ui';
import { db, notifyRunsChanged } from '../lib/db';
import { Markdown } from '../lib/markdown';
import { providerFor } from '../lib/session';
import { configuredProviders, getSettings, useSettings } from '../lib/settings';

/**
 * "Check the model": three small agent tasks that tell you whether a free
 * model is good enough to drive the agent — plain reply, reading a file with a
 * tool, and making an exact edit. Each runs on that model alone (no failover).
 */

interface TestCase {
  id: string;
  name: string;
  prompt: string;
  files: Record<string, string>;
  verify: (ws: MemoryWorkspace, reply: string, toolsUsed: string[]) => Promise<string | null>;
}

const TESTS: TestCase[] = [
  {
    id: 'reply',
    name: 'Plain reply',
    prompt: 'Reply with exactly the word READY and nothing else. Do not use any tools.',
    files: {},
    verify: async (_ws, reply) => (/\bready\b/i.test(reply) ? null : `expected "READY", got "${reply.slice(0, 80)}"`),
  },
  {
    id: 'tool',
    name: 'Tool use (read a file)',
    prompt: 'Read the file notes/secret.txt and tell me the secret word it contains.',
    files: { '/notes/secret.txt': 'The secret word is: PELICAN\n', '/README.md': '# Test project\n' },
    verify: async (_ws, reply, tools) =>
      !tools.includes('read_file') ? 'never called read_file' : /pelican/i.test(reply) ? null : 'read the file but did not report the word',
  },
  {
    id: 'edit',
    name: 'Exact edit',
    prompt: 'In src/config.ts change the version from 1 to 2. Change nothing else.',
    files: { '/src/config.ts': 'export const config = {\n  name: "demo",\n  version: 1,\n  debug: false,\n};\n' },
    verify: async (ws) => {
      const text = await ws.readFile('/src/config.ts');
      if (!/version:\s*2\b/.test(text)) return 'version was not changed to 2';
      if (!text.includes('name: "demo"') || !text.includes('debug: false')) return 'other lines were changed';
      return null;
    },
  },
];

interface Result {
  ok: boolean;
  ms: number;
  steps: number;
  tokens: number;
  problem?: string;
  reply: string;
}

async function runTest(ref: string, test: TestCase): Promise<Result> {
  const { provider, model } = parseModelRef(ref);
  const preset = PRESETS[provider]!;
  const ws = new MemoryWorkspace(test.files);
  const calls: CallRecord[] = [];
  const agent = new Agent({
    router: new ModelRouter([{ provider: providerFor(provider), model, contextWindow: preset.contextWindow, maxRequestTokens: preset.maxRequestTokens, prefer: preset.prefer }], {
      onCall: (c) => calls.push(c),
      maxInlineWaitMs: 8000,
    }),
    workspace: ws,
    tools: fileTools(),
    systemPrompt: 'You are a coding agent working in a small project through tools. Be brief.',
    permissions: new PermissionPolicy('auto'),
    maxSteps: 8,
  });
  const started = performance.now();
  const tools: string[] = [];
  let reply = '';
  let error: string | undefined;
  let steps = 0;
  let tokens = 0;
  for await (const ev of agent.run(test.prompt, { signal: AbortSignal.timeout(120_000) })) {
    if (ev.type === 'tool_end') tools.push(ev.call.name);
    if (ev.type === 'assistant' && ev.message.content) reply = ev.message.content;
    if (ev.type === 'error') error = ev.message;
    if (ev.type === 'usage') tokens += ev.usage.inputTokens + ev.usage.outputTokens;
    if (ev.type === 'done') steps = ev.steps;
  }
  const ms = performance.now() - started;
  const problem = error ?? (await test.verify(ws, reply, tools)) ?? undefined;
  await db
    .putRun({
      id: `c${Date.now().toString(36)}${test.id}`,
      projectId: 'model-check',
      projectName: 'Model check',
      prompt: `[${test.name}] ${test.prompt}`,
      startedAt: Date.now() - ms,
      ms,
      reason: error ? 'error' : 'completed',
      steps,
      models: [ref],
      inputTokens: calls.reduce((n, c) => n + (c.usage?.inputTokens ?? 0), 0),
      outputTokens: calls.reduce((n, c) => n + (c.usage?.outputTokens ?? 0), 0),
      tools: [],
      calls: calls.map((c) => ({ ref: c.ref, ok: c.ok, errorKind: c.errorKind, error: c.error, ms: c.ms, inputTokens: c.usage?.inputTokens, outputTokens: c.usage?.outputTokens, at: c.at })),
      notices: [],
      reply,
      compactions: 0,
      error,
    })
    .catch(() => undefined);
  notifyRunsChanged();
  return { ok: !problem, ms, steps, tokens, problem, reply };
}

function refsToCheck(): string[] {
  const s = getSettings();
  return configuredProviders(s).map((id) => (s.model.startsWith(`${id}:`) ? s.model : `${id}:${PRESETS[id]!.defaultModel}`));
}

export function ModelCheck() {
  const settings = useSettings();
  const [ref, setRef] = useState(settings.model || refsToCheck()[0] || '');
  const [results, setResults] = useState<Record<string, Record<string, Result | 'running'>>>({});
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState('Explain in two sentences what a React hook is.');
  const [chat, setChat] = useState<{ text: string; ms: number; ttft: number; tokens: number; error?: string } | null>(null);

  const check = async (refs: string[]) => {
    setBusy(true);
    for (const r of refs) {
      for (const t of TESTS) {
        setResults((prev) => ({ ...prev, [r]: { ...prev[r], [t.id]: 'running' } }));
        let result: Result;
        try {
          result = await runTest(r, t);
        } catch (err) {
          result = { ok: false, ms: 0, steps: 0, tokens: 0, problem: (err as Error).message, reply: '' };
        }
        setResults((prev) => ({ ...prev, [r]: { ...prev[r], [t.id]: result } }));
      }
    }
    setBusy(false);
  };

  const quickChat = async () => {
    if (!ref) return;
    setChat({ text: '', ms: 0, ttft: 0, tokens: 0 });
    const { provider, model } = parseModelRef(ref);
    const started = performance.now();
    let ttft = 0;
    let text = '';
    let tokens = 0;
    try {
      for await (const ev of providerFor(provider).stream({ model, system: 'You are a helpful assistant.', messages: [{ role: 'user', content: prompt }], tools: [], signal: AbortSignal.timeout(60_000) })) {
        if (ev.type === 'text') {
          if (!ttft) ttft = performance.now() - started;
          text += ev.delta;
          setChat({ text, ms: performance.now() - started, ttft, tokens });
        } else if (ev.type === 'usage') tokens = ev.usage.inputTokens + ev.usage.outputTokens;
      }
      setChat({ text, ms: performance.now() - started, ttft, tokens });
    } catch (err) {
      setChat({ text, ms: performance.now() - started, ttft, tokens, error: (err as Error).message });
    }
  };

  const all = refsToCheck();
  const rows = [...new Set([...Object.keys(results), ...(ref ? [ref] : [])])];

  return (
    <div className="space-y-4 p-5">
      <div>
        <h1 className="text-lg font-semibold">Model check</h1>
        <p className="text-xs text-zinc-500">Test whether a model can drive the agent before you rely on it: a plain reply, a tool call, and an exact file edit. Runs on that model only, with no fallback.</p>
      </div>

      <Card
        title="Agent readiness"
        actions={
          <>
            <input value={ref} onChange={(e) => setRef(e.target.value)} list="model-refs" placeholder="provider:model" className="w-72 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs" />
            <datalist id="model-refs">
              {Object.values(PRESETS).flatMap((p) => p.models.map((m) => <option key={`${p.id}:${m}`} value={`${p.id}:${m}`} />))}
            </datalist>
            <Button variant="primary" disabled={busy || !ref} onClick={() => void check([ref])}>
              <Play size={12} /> Check
            </Button>
            <Button disabled={busy || !all.length} onClick={() => void check(all)} title="Check the default model of every configured provider">
              Check all configured
            </Button>
          </>
        }
      >
        {!rows.length ? (
          <p className="text-xs text-zinc-500">Add a provider key first (Providers page), then press Check.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 font-normal">Model</th>
                {TESTS.map((t) => (
                  <th key={t.id} className="font-normal">{t.name}</th>
                ))}
                <th className="text-right font-normal">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const res = results[r] ?? {};
                const done = TESTS.map((t) => res[t.id]).filter((x): x is Result => !!x && x !== 'running');
                const passed = done.filter((d) => d.ok).length;
                return (
                  <tr key={r} className="border-t border-zinc-800 align-top">
                    <td className="py-2 pr-3 font-medium text-zinc-200">{r}</td>
                    {TESTS.map((t) => {
                      const x = res[t.id];
                      return (
                        <td key={t.id} className="py-2 pr-3">
                          {x === 'running' ? (
                            <span className="flex items-center gap-1 text-sky-300"><Loader2 size={12} className="animate-spin" /> running</span>
                          ) : x ? (
                            <div className={cx('flex items-start gap-1', x.ok ? 'text-emerald-300' : 'text-red-300')} title={x.problem ?? x.reply}>
                              {x.ok ? <CheckCircle2 size={12} className="mt-px shrink-0" /> : <XCircle size={12} className="mt-px shrink-0" />}
                              <span>
                                {x.ok ? 'Pass' : 'Fail'} <span className="text-zinc-500">· {fmtMs(x.ms)} · {x.steps} steps · {fmtTokens(x.tokens)} tok</span>
                                {x.problem && <div className="max-w-56 truncate text-zinc-500">{x.problem}</div>}
                              </span>
                            </div>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="py-2 text-right">
                      {done.length === TESTS.length ? (
                        <span className={cx('font-medium', passed === TESTS.length ? 'text-emerald-300' : passed >= 2 ? 'text-amber-300' : 'text-red-300')}>
                          {passed === TESTS.length ? '✓ Ready' : passed >= 2 ? '⚠ Usable' : '✗ Not suitable'} ({passed}/{TESTS.length})
                        </span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Quick prompt" actions={<Button variant="primary" onClick={() => void quickChat()} disabled={!ref}><Play size={12} /> Send to {ref || '…'}</Button>}>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} className="w-full resize-y rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" />
        {chat && (
          <div className="mt-3 space-y-2">
            <div className="flex gap-3 text-[11px] text-zinc-500">
              <span>first token {chat.ttft ? fmtMs(chat.ttft) : '—'}</span>
              <span>total {fmtMs(chat.ms)}</span>
              {chat.tokens > 0 && <span>{fmtTokens(chat.tokens)} tokens</span>}
            </div>
            {chat.error && <div className="rounded bg-red-500/10 px-3 py-2 text-xs text-red-300">{chat.error}</div>}
            {chat.text && <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3"><Markdown text={chat.text} /></div>}
          </div>
        )}
      </Card>
    </div>
  );
}
