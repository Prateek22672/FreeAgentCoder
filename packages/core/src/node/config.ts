import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import type { PermissionMode } from '../agent/permissions';
import type { Effort } from '../providers/anthropic';
import {
  createProvider,
  FREE_ORDER,
  parseModelRef,
  PRESETS,
  type ModelRef,
  type ProviderPreset,
} from '../providers/presets';
import { ModelRouter, type RouterEntry } from '../providers/router';

export interface CustomProvider {
  id: string;
  label?: string;
  baseURL: string;
  model: string;
  apiKey?: string;
  contextWindow?: number;
}

/** ~/.agentic/config.json */
export interface AgenticConfig {
  /** Main model as "provider:model". Default: the first free provider you have a key for. */
  model?: string;
  /** Fallback order (provider ids or provider:model). Default: every other free provider you have a key for. */
  fallbacks?: string[];
  /** API keys by provider id. Environment variables take precedence. */
  keys?: Record<string, string>;
  /** Base URL overrides by provider id (e.g. a remote Ollama). */
  baseURLs?: Record<string, string>;
  /** Use a local Ollama server as a fallback. */
  ollama?: boolean;
  /** Default permission mode. */
  mode?: PermissionMode;
  maxContextTokens?: number;
  /** Claude's reasoning effort. */
  effort?: Effort;
  /** Shell for run_command (path to bash.exe, powershell.exe, ...). */
  shell?: string;
  custom?: CustomProvider[];
}

export function configDir(): string {
  return process.env.AGENTIC_HOME || path.join(homedir(), '.agentic');
}

export function configPath(): string {
  return path.join(configDir(), 'config.json');
}

export async function loadConfig(): Promise<AgenticConfig> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath(), 'utf8');
  } catch {
    return {};
  }
  try {
    // Windows editors (and PowerShell's -Encoding utf8) add a BOM that JSON.parse rejects.
    return JSON.parse(raw.replace(/^﻿/, '')) as AgenticConfig;
  } catch (err) {
    throw new Error(`Could not parse ${configPath()}: ${(err as Error).message}`);
  }
}

export async function saveConfig(config: AgenticConfig): Promise<void> {
  await fs.mkdir(configDir(), { recursive: true });
  // Owner-only on POSIX. (On Windows the file lives in your user profile, which only you can read.)
  await fs.writeFile(configPath(), `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function presetsWithCustom(config: AgenticConfig): Record<string, ProviderPreset> {
  const all: Record<string, ProviderPreset> = { ...PRESETS };
  for (const c of config.custom ?? []) {
    all[c.id] = {
      id: c.id,
      label: c.label ?? c.id,
      kind: 'openai',
      baseURL: c.baseURL,
      keyEnv: [],
      needsKey: false,
      free: true,
      defaultModel: c.model,
      models: [c.model],
      prefer: [],
      contextWindow: c.contextWindow ?? 32_768,
      signupUrl: '',
      note: 'Custom OpenAI-compatible endpoint.',
    };
  }
  return all;
}

export function resolveKey(preset: ProviderPreset, config: AgenticConfig): string | undefined {
  for (const name of preset.keyEnv) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  const custom = config.custom?.find((c) => c.id === preset.id);
  return config.keys?.[preset.id]?.trim() || custom?.apiKey || undefined;
}

function baseURLFor(preset: ProviderPreset, config: AgenticConfig): string | undefined {
  if (config.baseURLs?.[preset.id]) return config.baseURLs[preset.id];
  if (preset.id === 'ollama' && process.env.OLLAMA_HOST) {
    const host = process.env.OLLAMA_HOST.replace(/\/+$/, '');
    return `${/^https?:/.test(host) ? host : `http://${host}`}/v1`;
  }
  return undefined;
}

/** Providers that can be used right now (key present, or keyless and enabled). */
export function usableProviders(config: AgenticConfig): ProviderPreset[] {
  const presets = presetsWithCustom(config);
  return Object.values(presets).filter((p) => {
    if (p.id === 'ollama') return !!config.ollama || !!process.env.OLLAMA_HOST;
    if (!p.needsKey) return true;
    return !!resolveKey(p, config);
  });
}

export interface BuiltRouter {
  router: ModelRouter;
  /** Why some requested models were left out. */
  warnings: string[];
}

/**
 * Main model first, then the free fallbacks. Paid providers (Claude, OpenAI)
 * are only ever used when you ask for them: they are never added
 * automatically, so a key sitting in your environment can't cost you money.
 */
export function buildRouter(config: AgenticConfig, override?: string): BuiltRouter {
  const presets = presetsWithCustom(config);
  const usable = new Set(usableProviders(config).map((p) => p.id));
  const warnings: string[] = [];
  const refs: ModelRef[] = [];

  const add = (ref: ModelRef, explicit: boolean) => {
    if (refs.some((r) => r.provider === ref.provider && r.model === ref.model)) return;
    if (!usable.has(ref.provider)) {
      if (explicit) {
        const preset = presets[ref.provider];
        warnings.push(
          preset?.id === 'ollama'
            ? 'Ollama is not enabled (run: agentic setup).'
            : `No API key for ${preset?.label ?? ref.provider}${preset?.keyEnv[0] ? ` (set ${preset.keyEnv[0]} or run: agentic setup)` : ''}.`,
        );
      }
      return;
    }
    refs.push(ref);
  };

  const primary = override ?? config.model;
  if (primary) {
    try {
      add(parseModelRef(primary, presets), true);
    } catch (err) {
      warnings.push((err as Error).message);
    }
  }
  if (config.fallbacks) {
    for (const fb of config.fallbacks) {
      try {
        add(parseModelRef(fb, presets), true);
      } catch (err) {
        warnings.push((err as Error).message);
      }
    }
  } else {
    const order = [...FREE_ORDER, ...(config.custom ?? []).map((c) => c.id)];
    for (const id of order) {
      const preset = presets[id];
      if (!preset?.free || refs.some((r) => r.provider === id)) continue;
      add({ provider: id, model: preset.defaultModel }, false);
    }
  }

  const entries: RouterEntry[] = refs.map((ref) => {
    const preset = presets[ref.provider]!;
    return {
      provider: createProvider(preset, {
        apiKey: resolveKey(preset, config),
        baseURL: baseURLFor(preset, config),
        effort: config.effort,
      }),
      model: ref.model,
      contextWindow: preset.contextWindow,
      maxRequestTokens: preset.maxRequestTokens,
      prefer: preset.prefer,
    };
  });
  return { router: new ModelRouter(entries), warnings };
}
