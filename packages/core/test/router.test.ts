import { describe, expect, it } from 'vitest';
import { ProviderError } from '../src/providers/errors';
import { AllProvidersFailedError, ContextTooLargeError, ModelRouter, type RouterEntry, type RouterEvent } from '../src/providers/router';
import type { AssistantMessage } from '../src/types';
import { say, ScriptedProvider, type Step } from './helpers';

const fail = (kind: ProviderError['kind'], retryAfterMs?: number): Step => () => new ProviderError(`boom (${kind})`, kind, { retryAfterMs });

function entry(id: string, script: Step[], extra: Partial<RouterEntry> = {}): RouterEntry & { provider: ScriptedProvider } {
  return { provider: new ScriptedProvider(script, id), model: `${id}-model`, contextWindow: 100_000, ...extra } as RouterEntry & {
    provider: ScriptedProvider;
  };
}

async function drive(router: ModelRouter, content = 'hi') {
  const events: RouterEvent[] = [];
  const gen = router.stream({ system: 's', messages: [{ role: 'user', content }], tools: [] });
  let next = await gen.next();
  while (!next.done) {
    events.push(next.value);
    next = await gen.next();
  }
  return { events, message: next.value as AssistantMessage };
}

describe('ModelRouter', () => {
  it('waits out a short rate limit on the same model', async () => {
    const slept: number[] = [];
    const a = entry('a', [fail('rate_limit', 2000), say('ok')]);
    const router = new ModelRouter([a], { sleep: async (ms) => void slept.push(ms) });
    const { message, events } = await drive(router);
    expect(message.content).toBe('ok');
    expect(slept[0]).toBeGreaterThanOrEqual(2000);
    expect(events.some((e) => e.type === 'notice' && e.message.includes('retrying'))).toBe(true);
  });

  it('fails over on a long rate limit and puts the model on cooldown', async () => {
    let now = 1_000_000;
    const a = entry('a', [fail('rate_limit', 120_000), say('a is back')]);
    const b = entry('b', [say('from b'), say('b again')]);
    const router = new ModelRouter([a, b], { now: () => now, sleep: async () => {} });
    expect((await drive(router)).message.content).toBe('from b');
    // While a cools down, b serves directly without retrying a.
    expect((await drive(router)).message.content).toBe('b again');
    expect(a.provider.requests).toHaveLength(1);
    now += 121_000;
    expect((await drive(router)).message.content).toBe('a is back');
  });

  it('routes requests that are too big for a free tier to a bigger model', async () => {
    const small = entry('small', [say('never')], { maxRequestTokens: 50 });
    const big = entry('big', [say('from big')]);
    const router = new ModelRouter([small, big]);
    const { message } = await drive(router, 'x'.repeat(2000));
    expect(message.content).toBe('from big');
    expect(small.provider.requests).toHaveLength(0);
  });

  it('remembers a too_large rejection', async () => {
    const a = entry('a', [fail('too_large'), say('a small ok')]);
    const b = entry('b', [say('b took it')]);
    const router = new ModelRouter([a, b]);
    expect((await drive(router, 'y'.repeat(1000))).message.content).toBe('b took it');
    expect((await drive(router, 'short')).message.content).toBe('a small ok');
  });

  it('throws ContextTooLargeError when nothing fits', async () => {
    const router = new ModelRouter([entry('a', [], { maxRequestTokens: 10 })]);
    await expect(drive(router, 'z'.repeat(500))).rejects.toBeInstanceOf(ContextTooLargeError);
  });

  it('replaces a retired model from the live model list', async () => {
    const a = entry('a', [fail('model_not_found'), say('new model ok')], { prefer: [/^fresh-/] });
    a.provider.listModels = async () => ['old-thing', 'fresh-2', 'fresh-10'];
    const router = new ModelRouter([a]);
    const { message, events } = await drive(router);
    expect(message.content).toBe('new model ok');
    expect(a.model).toBe('fresh-10');
    expect(events.some((e) => e.type === 'notice' && e.message.includes('fresh-10'))).toBe(true);
  });

  it('retries a malformed tool call at a lower temperature', async () => {
    const a = entry('a', [fail('bad_tool_call'), say('fixed')]);
    const router = new ModelRouter([a]);
    await drive(router);
    expect(a.provider.requests[1]!.temperature).toBe(0.2);
  });

  it('never shops a refusal to another provider', async () => {
    const a = entry('a', [fail('refusal')]);
    const b = entry('b', [say('should not be used')]);
    const router = new ModelRouter([a, b]);
    await expect(drive(router)).rejects.toMatchObject({ kind: 'refusal' });
    expect(b.provider.requests).toHaveLength(0);
  });

  it('disables a provider with a bad key and reports every failure', async () => {
    const a = entry('a', [fail('auth')]);
    const b = entry('b', [fail('bad_request')]);
    const router = new ModelRouter([a, b]);
    const err = await drive(router).catch((e) => e);
    expect(err).toBeInstanceOf(AllProvidersFailedError);
    expect(err.message).toContain('a:a-model');
    expect(err.message).toContain('b:b-model');
  });
});
