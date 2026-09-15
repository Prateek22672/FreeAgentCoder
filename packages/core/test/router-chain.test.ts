import { describe, expect, it } from 'vitest';
import { ProviderError } from '../src/providers/errors';
import { AllProvidersFailedError, ModelRouter, type RouterEntry, type RouterEvent } from '../src/providers/router';
import type { AssistantMessage } from '../src/types';
import { say, ScriptedProvider, type Step } from './helpers';

const fail = (kind: ProviderError['kind'], retryAfterMs?: number): Step => () => new ProviderError(`boom (${kind})`, kind, { retryAfterMs });

function keyEntry(label: string, script: Step[]): RouterEntry & { provider: ScriptedProvider } {
  return { provider: new ScriptedProvider(script, 'groq'), model: 'gpt-oss-120b', contextWindow: 100_000, label } as RouterEntry & {
    provider: ScriptedProvider;
  };
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

describe('ModelRouter with one entry per API key', () => {
  it('rotates to the next key of the same model and names both keys', async () => {
    const personal = keyEntry('Personal', [fail('rate_limit', 120_000)]);
    const college = keyEntry('College', [say('from college')]);
    const router = new ModelRouter([personal, college], { sleep: async () => {} });

    const { message, events } = await drive(router);

    expect(message.content).toBe('from college');
    const notice = events.find((e) => e.type === 'notice');
    expect(notice && notice.type === 'notice' && notice.message).toBe(
      'groq:gpt-oss-120b (Personal) failed (rate limit); switching to groq:gpt-oss-120b (College).',
    );
  });

  it('keeps a reused entry on cooldown after the chain is replaced', async () => {
    let now = 1_000_000;
    const a = keyEntry('A', [fail('rate_limit', 120_000), say('a is back')]);
    const b = keyEntry('B', [say('b1'), say('b2')]);
    const router = new ModelRouter([a, b], { now: () => now, sleep: async () => {} });
    expect((await drive(router)).message.content).toBe('b1');

    router.replaceChain([a, b]);
    expect((await drive(router)).message.content).toBe('b2');
    expect(a.provider.requests).toHaveLength(1);

    now += 121_000;
    expect((await drive(router)).message.content).toBe('a is back');
  });

  it('only reports entries that are still in the chain when everything is disabled', async () => {
    const stale = keyEntry('Old', [fail('auth')]);
    const current = keyEntry('New', [fail('auth')]);
    const router = new ModelRouter([stale], { sleep: async () => {} });
    await expect(drive(router)).rejects.toBeInstanceOf(AllProvidersFailedError);

    router.replaceChain([current]);
    const error = await drive(router).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AllProvidersFailedError);
    expect((error as AllProvidersFailedError).failures.map((f) => f.ref)).toEqual(['groq:gpt-oss-120b (New)']);
  });
});
