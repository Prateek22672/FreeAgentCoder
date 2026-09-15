import { createProvider, FREE_ORDER, PRESETS, type ProviderPreset } from '@agentic/core';
import { loadConfig, resolveKey, saveConfig, usableProviders, type AgenticConfig } from '@agentic/core/node';
import type { Terminal } from './terminal';
import { c, line } from './ui';

function mask(key: string): string {
  return key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : '••••';
}

/** Try one tiny request so a typo in the key is caught right away. */
async function testKey(preset: ProviderPreset, apiKey: string | undefined, baseURL?: string): Promise<string | null> {
  try {
    const provider = createProvider(preset, { apiKey, baseURL });
    const models = await provider.listModels(AbortSignal.timeout(15_000));
    return models.length ? null : 'the provider returned no models';
  } catch (err) {
    return (err as Error).message;
  }
}

export async function runSetup(term: Terminal, config?: AgenticConfig): Promise<AgenticConfig> {
  const cfg = config ?? (await loadConfig());
  cfg.keys ??= {};

  line(c.bold('Agentic setup'));
  line(c.dim('Add free API keys. Each one you add becomes a fallback, so you rarely hit rate limits.'));
  line(c.dim('Keys are stored in ~/.agentic/config.json. Press Enter to skip a provider; Ctrl+C to stop.'));
  line();

  const order = [...FREE_ORDER.filter((id) => id !== 'ollama'), 'anthropic', 'openai'];
  for (const id of order) {
    const preset = PRESETS[id]!;
    const existing = resolveKey(preset, cfg);
    const fromEnv = preset.keyEnv.some((n) => process.env[n]);
    line(`${c.bold(preset.label)} ${preset.free ? c.green('free') : c.yellow('paid')}  ${c.dim(preset.note)}`);
    line(c.dim(`  Get a key: ${preset.signupUrl}`));
    if (existing) {
      line(c.dim(`  Current: ${mask(existing)}${fromEnv ? ` (from ${preset.keyEnv.find((n) => process.env[n])})` : ''}`));
    }
    const answer = await term.askSecret(`  API key${existing ? ' (Enter to keep)' : ''}: `);
    if (answer === null) break;
    if (!answer) {
      line();
      continue;
    }
    process.stdout.write(c.dim('  Checking… '));
    const problem = await testKey(preset, answer);
    if (problem) {
      line(c.red(`failed: ${problem}`));
      const keep = await term.ask('  Save it anyway? (y/N) ');
      if (!keep || !/^y/i.test(keep)) {
        line();
        continue;
      }
    } else {
      line(c.green('works'));
    }
    cfg.keys[id] = answer;
    line();
  }

  const ollama = await term.ask(`${c.bold('Ollama (local)')} — use a local Ollama server as a fallback? (y/N) `);
  if (ollama && /^y/i.test(ollama)) {
    process.stdout.write(c.dim('  Checking http://localhost:11434… '));
    const problem = await testKey(PRESETS.ollama!, undefined);
    line(problem ? c.yellow(`not reachable (${problem.split('\n')[0]}). Saved anyway; start Ollama before use.`) : c.green('works'));
    cfg.ollama = true;
  }

  const usable = usableProviders(cfg);
  if (!usable.length) {
    line();
    line(c.yellow('No providers configured. Add at least one free key to use Agentic.'));
  } else {
    cfg.model ??= `${usable[0]!.id}:${usable[0]!.defaultModel}`;
    line();
    line(`Ready. Providers: ${usable.map((p) => c.green(p.label)).join(', ')}.`);
    line(c.dim(`Main model: ${cfg.model} (change it anytime with /model)`));
  }
  await saveConfig(cfg);
  return cfg;
}
