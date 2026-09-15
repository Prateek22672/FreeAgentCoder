import { describe, expect, it } from 'vitest';
import { ProviderError } from '../src/providers/errors';
import { ModelRouter, type RouterEntry, type RouterEvent } from '../src/providers/router';
import type { AssistantMessage } from '../src/types';
import { say, ScriptedProvider, type Step } from './helpers';

const fail = (kind: ProviderError['kind'], retryAfterMs?: number): Step => () => new ProviderError(`boom (${kind})`, kind, { retryAfterMs });

function entry(id: string, script: Step[]): RouterEntry & { provider: ScriptedProvider } {
  return { provider: new ScriptedProvider(script, id), model: `${id}-model`, contextWindow: 100_000 } as RouterEntry & { provider: ScriptedProvider };
}

async function drive(router: ModelRouter) {
  const events: RouterEvent[] = [];
  const gen = router.stream({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [] });
  let next = await gen.next();
  while (!next.done) {
    events.push(next.value);
    next = await gen.next();
  }
  return { events, message: next.value as AssistantMessage };
}

describe('ModelRouter failover speed', () => {
  it('fails over at once on a server error and skips the broken model while it cools down', async () => {
    let now = 0;
    const slept: number[] = [];
    const a = entry('a', [fail('server'), say('a is back')]);
    const b = entry('b', [say('b1'), say('b2')]);
    const router = new ModelRouter([a, b], { now: () => now, sleep: async (ms) => void slept.push(ms) });

    expect((await drive(router)).message.content).toBe('b1');
    expect(slept).toEqual([]);
    expect((await drive(router)).message.content).toBe('b2');
    expect(a.provider.requests).toHaveLength(1);

    now += 31_000;
    expect((await drive(router)).message.content).toBe('a is back');
  });

  it('still retries a server error in place when no other model can answer', async () => {
    const slept: number[] = [];
    const a = entry('a', [fail('server'), say('ok')]);
    const router = new ModelRouter([a], { sleep: async (ms) => void slept.push(ms) });
    expect((await drive(router)).message.content).toBe('ok');
    expect(slept).toEqual([1_500]);
  });

  it('does not wait out a short rate limit when another model can answer', async () => {
    const slept: number[] = [];
    const a = entry('a', [fail('rate_limit', 5_000)]);
    const b = entry('b', [say('from b')]);
    const router = new ModelRouter([a, b], { sleep: async (ms) => void slept.push(ms) });
    expect((await drive(router)).message.content).toBe('from b');
    expect(slept).toEqual([]);
  });

  it('backs off for longer after repeated failures and resets after a success', async () => {
    let now = 0;
    const a = entry('a', [fail('server'), fail('server'), say('a ok')]);
    const b = entry('b', [say('b1'), say('b2'), say('b3')]);
    const router = new ModelRouter([a, b], { now: () => now, sleep: async () => {} });

    expect((await drive(router)).message.content).toBe('b1'); // a parked for 30s
    now += 31_000;
    expect((await drive(router)).message.content).toBe('b2'); // a fails again, parked for 60s
    now += 31_000;
    expect((await drive(router)).message.content).toBe('b3'); // a still cooling
    expect(a.provider.requests).toHaveLength(2);
    now += 31_000;
    expect((await drive(router)).message.content).toBe('a ok');
  });

  it('parks a model that rejects the request instead of retrying it every step', async () => {
    const a = entry('a', [fail('bad_request')]);
    const b = entry('b', [say('b1'), say('b2')]);
    const router = new ModelRouter([a, b], { now: () => 0, sleep: async () => {} });
    await drive(router);
    await drive(router);
    expect(a.provider.requests).toHaveLength(1);
  });

  it('parks a model that keeps hitting rate limits for longer each time', async () => {
    let now = 0;
    const a = entry('a', [fail('rate_limit', 1_000), fail('rate_limit', 1_000), say('a ok')]);
    const b = entry('b', [say('b1'), say('b2'), say('b3'), say('b4')]);
    const router = new ModelRouter([a, b], { now: () => now, sleep: async () => {} });

    expect((await drive(router)).message.content).toBe('b1'); // a parked 15s
    now += 16_000;
    expect((await drive(router)).message.content).toBe('b2'); // a limited again, parked 30s
    now += 16_000;
    expect((await drive(router)).message.content).toBe('b3'); // a still parked
    expect(a.provider.requests).toHaveLength(2);
    now += 15_000;
    expect((await drive(router)).message.content).toBe('a ok');
  });
});
