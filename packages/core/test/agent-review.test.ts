import { describe, expect, it } from 'vitest';
import { Agent } from '../src/agent/agent';
import { PermissionPolicy } from '../src/agent/permissions';
import { ModelRouter } from '../src/providers/router';
import { MemoryWorkspace } from '../src/workspace/memory';
import { collect, say, ScriptedProvider, type Step } from './helpers';

function setup(script: Step[], reviewCompletion: () => string | undefined) {
  const provider = new ScriptedProvider(script);
  const agent = new Agent({
    router: new ModelRouter([{ provider, model: 'fake', contextWindow: 200_000 }]),
    workspace: new MemoryWorkspace({}),
    tools: [],
    systemPrompt: 'test',
    permissions: new PermissionPolicy('auto'),
    reviewCompletion,
  });
  return { provider, agent };
}

describe('Agent completion review', () => {
  it('sends the model back to work when the review finds something missing', async () => {
    let reviews = 0;
    const { provider, agent } = setup([say('Done, the app is ready.'), say('Ran flutter analyze; no issues.')], () =>
      reviews++ === 0 ? 'Run flutter analyze before finishing.' : undefined,
    );

    const events = await collect(agent.run('build the app'));

    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]!.messages.some((m) => m.role === 'user' && m.content === 'Run flutter analyze before finishing.')).toBe(true);
    expect(events.some((e) => e.type === 'notice' && e.message.includes('not finished yet'))).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'completed' });
  });

  it('gives up after two reviews so a turn can always end', async () => {
    const { provider, agent } = setup([say('one'), say('two'), say('three')], () => 'still missing checks');
    const events = await collect(agent.run('build the app'));
    expect(provider.requests).toHaveLength(3);
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'completed' });
  });
});
