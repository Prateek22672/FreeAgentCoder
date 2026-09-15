import {
  Agent,
  buildBuilderSystemPrompt,
  createProvider,
  fileTools,
  MemoryWorkspace,
  ModelRouter,
  parseModelRef,
  PermissionPolicy,
  PRESETS,
  type AgentOptions,
  type CallRecord,
  type Message,
  type ProviderPreset,
  type RouterEntry,
  type Todo,
} from '@agentic/core';
import { checkPreviewTool, type PreviewBridge } from './preview';
import { getSettings, modelChain, type Settings } from './settings';

/** Where a provider is called from the browser: directly, via the dev proxy, or via a deployed relay. */
export function baseURLFor(preset: ProviderPreset, s: Settings): string | undefined {
  if (preset.id === 'ollama') return s.ollamaUrl || preset.baseURL;
  if (s.relayUrl.trim()) return `${s.relayUrl.trim().replace(/\/+$/, '')}/${preset.id}`;
  if (s.useDevRelay && import.meta.env.DEV) return `${location.origin}/relay/${preset.id}`;
  return undefined;
}

export function providerFor(id: string, s: Settings = getSettings()) {
  const preset = PRESETS[id];
  if (!preset) throw new Error(`Unknown provider ${id}`);
  return createProvider(preset, {
    apiKey: s.keys[id]?.trim() || undefined,
    baseURL: baseURLFor(preset, s),
    browser: true,
    effort: s.effort,
  });
}

export interface ProviderCheck {
  ok: boolean;
  ms: number;
  models: string[];
  error?: string;
}

/** One cheap request (list models) to verify a key and measure latency. */
export async function checkProvider(id: string, s: Settings = getSettings()): Promise<ProviderCheck> {
  const started = performance.now();
  try {
    const models = await providerFor(id, s).listModels(AbortSignal.timeout(15_000));
    return { ok: true, ms: Math.round(performance.now() - started), models };
  } catch (err) {
    return { ok: false, ms: Math.round(performance.now() - started), models: [], error: (err as Error).message };
  }
}

export function buildRouter(s: Settings, onCall?: (r: CallRecord) => void): ModelRouter {
  const entries: RouterEntry[] = [];
  for (const ref of modelChain(s)) {
    try {
      const { provider, model } = parseModelRef(ref);
      const preset = PRESETS[provider]!;
      entries.push({
        provider: providerFor(provider, s),
        model,
        contextWindow: preset.contextWindow,
        maxRequestTokens: preset.maxRequestTokens,
        prefer: preset.prefer,
      });
    } catch {
      // skip unparseable refs
    }
  }
  return new ModelRouter(entries, { onCall });
}

export interface BuilderSession {
  agent: Agent;
  workspace: MemoryWorkspace;
  router: ModelRouter;
}

export function createBuilderSession(opts: {
  files: Record<string, string>;
  bridge: PreviewBridge;
  messages?: Message[];
  todos?: Todo[];
  approve?: AgentOptions['approve'];
  onCall?: (r: CallRecord) => void;
}): BuilderSession {
  const s = getSettings();
  const workspace = new MemoryWorkspace(opts.files);
  const router = buildRouter(s, opts.onCall);
  const agent = new Agent({
    router,
    workspace,
    tools: [...fileTools(), checkPreviewTool(opts.bridge)],
    systemPrompt: buildBuilderSystemPrompt(new Date().toISOString().slice(0, 10)),
    permissions: new PermissionPolicy(s.mode),
    approve: opts.approve,
    maxContextTokens: s.maxContextTokens,
    messages: opts.messages,
    todos: opts.todos,
    maxSteps: 60,
  });
  return { agent, workspace, router };
}
