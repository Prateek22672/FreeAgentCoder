import { FREE_ORDER, PRESETS, type PermissionMode } from '@agentic/core';
import { useSyncExternalStore } from 'react';

/**
 * Everything the browser app remembers: API keys, model chain, mode, relay
 * URL. Lives in localStorage on this device only; nothing is sent anywhere
 * except to the providers you call.
 */
export interface Settings {
  keys: Record<string, string>;
  /** "provider:model" */
  model: string;
  /** Explicit fallback chain (provider ids or refs). Empty = every free provider with a key. */
  fallbacks: string[];
  mode: PermissionMode;
  /** Base URL of a deployed relay (apps/relay), or '' to call providers directly. */
  relayUrl: string;
  /** Route calls through /relay in dev (Vite proxy) — avoids CORS for Groq/Cerebras/Mistral. */
  useDevRelay: boolean;
  ollamaUrl: string;
  ollama: boolean;
  maxContextTokens: number;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

const KEY = 'agentic.settings.v1';

const DEFAULTS: Settings = {
  keys: {},
  model: '',
  fallbacks: [],
  mode: 'auto-edit',
  relayUrl: '',
  useDevRelay: true,
  ollamaUrl: 'http://localhost:11434/v1',
  ollama: false,
  maxContextTokens: 60_000,
  effort: 'xhigh',
};

let current: Settings = load();
const listeners = new Set<() => void>();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)): void {
  const next = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) };
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage full or blocked: keep it in memory
  }
  for (const fn of listeners) fn();
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}

/** Providers usable right now: free ones with a key, Ollama if enabled. Paid ones only when keyed. */
export function configuredProviders(s: Settings = current): string[] {
  return Object.values(PRESETS)
    .filter((p) => (p.id === 'ollama' ? s.ollama : !!s.keys[p.id]?.trim()))
    .map((p) => p.id);
}

/** The model chain the app will use: main model first, then free fallbacks. */
export function modelChain(s: Settings = current): string[] {
  const configured = new Set(configuredProviders(s));
  const refs: string[] = [];
  const add = (ref: string) => {
    const provider = ref.split(':')[0]!;
    if (configured.has(provider) && !refs.includes(ref)) refs.push(ref);
  };
  if (s.model) add(s.model);
  if (s.fallbacks.length) {
    for (const fb of s.fallbacks) add(fb.includes(':') ? fb : `${fb}:${PRESETS[fb]?.defaultModel ?? ''}`);
  } else {
    for (const id of FREE_ORDER) {
      const preset = PRESETS[id]!;
      if (!refs.some((r) => r.startsWith(`${id}:`))) add(`${id}:${preset.defaultModel}`);
    }
  }
  return refs;
}

export function maskKey(key: string): string {
  const k = key.trim();
  return k.length > 10 ? `${k.slice(0, 5)}…${k.slice(-4)}` : k ? '••••••' : '';
}
