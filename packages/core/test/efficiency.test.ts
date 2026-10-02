import { describe, expect, it } from 'vitest';
import { Agent } from '../src/agent/agent';
import { PermissionPolicy } from '../src/agent/permissions';
import { requestView } from '../src/agent/view';
import { ModelRouter } from '../src/providers/router';
import { fileTools } from '../src/tools/index';
import type { Message } from '../src/types';
import { MemoryWorkspace } from '../src/workspace/memory';
import { call, calls, collect, say, ScriptedProvider, type Step } from './helpers';

function setup(script: Step[], files: Record<string, string> = { '/src/app.ts': 'const a = 1;\n' }) {
  const provider = new ScriptedProvider(script);
  const agent = new Agent({
    router: new ModelRouter([{ provider, model: 'fake', contextWindow: 200_000 }]),
    workspace: new MemoryWorkspace(files),
    tools: fileTools(),
    systemPrompt: 'test',
    permissions: new PermissionPolicy('auto'),
  });
  return { agent, provider };
}

const sent = (provider: ScriptedProvider, n: number) => JSON.stringify(provider.requests[n]!.messages);

describe('what each request carries', () => {
  const step = (id: string, name: string, args: Record<string, unknown>, content: string): Message[] => [
    { role: 'assistant', content: '', toolCalls: [{ id, name, args }] },
    { role: 'tool', toolCallId: id, name, content },
  ];

  it('cuts long results, more for older steps, and keeps start and end', () => {
    const long = `START${'x'.repeat(20_000)}END`;
    const messages = [...step('a', 'grep', { pattern: 'x' }, long), ...step('b', 'grep', { pattern: 'y' }, long), ...step('c', 'grep', { pattern: 'z' }, long)];
    const view = requestView(messages);
    const sizes = view.filter((m) => m.role === 'tool').map((m) => m.content.length);
    expect(sizes[0]).toBeLessThan(4_200);
    expect(sizes[1]).toBeGreaterThan(7_900);
    expect(sizes[2]).toBeGreaterThan(7_900);
    for (const m of view.filter((x) => x.role === 'tool')) {
      expect(m.content.startsWith('START')).toBe(true);
      expect(m.content.endsWith('END')).toBe(true);
      expect(m.content).toContain('left out to save tokens');
    }
    // The kept conversation is untouched.
    expect(messages[1]!.content).toBe(long);
  });

  it('replaces a read once the file is read again in full or changed', () => {
    const messages = [
      ...step('a', 'read_file', { path: 'src/app.ts' }, 'OLD BODY'),
      ...step('b', 'read_file', { path: 'src/app.ts', offset: 10, limit: 5 }, 'PART'),
      ...step('c', 'read_file', { path: 'src/other.ts' }, 'OTHER BODY'),
    ];
    // A partial read does not stand in for the full one.
    expect(JSON.stringify(requestView(messages))).toContain('OLD BODY');
    const edited = [...messages, ...step('d', 'edit_file', { path: './src/app.ts', old_string: 'a', new_string: 'b' }, 'Edited src/app.ts.')];
    const view = JSON.stringify(requestView(edited));
    expect(view).not.toContain('OLD BODY');
    expect(view).not.toContain('PART');
    expect(view).toContain('[Outdated: src/app.ts was read again or changed later');
    expect(view).toContain('OTHER BODY');
  });

  it('sends nothing new when there is nothing to trim', () => {
    const messages = step('a', 'read_file', { path: 'a.ts' }, 'short');
    expect(requestView(messages)).toBe(messages);
  });

  it('is what the agent actually sends', async () => {
    const big = `${'line of code\n'.repeat(2_000)}`;
    const { agent, provider } = setup([call('read_file', { path: 'big.ts' }), call('read_file', { path: 'big.ts' }), say('Done.')], { '/big.ts': big });
    await collect(agent.run('look twice'));
    // The second request carries the first read cut down; the third has it replaced by the second.
    expect(sent(provider, 1).length).toBeLessThan(12_000);
    expect(sent(provider, 2)).toContain('[Outdated: big.ts');
    expect(JSON.stringify(agent.messages).length).toBeGreaterThan(40_000);
  });
});

describe('stopping a stuck model', () => {
  it('stops after five identical calls in a row', async () => {
    const same = () => call('glob', { pattern: '*.md' });
    const { agent, provider } = setup([same(), same(), same(), same(), same(), say('never')]);
    const events = await collect(agent.run('find docs'));
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'error' });
    expect(events.find((e) => e.type === 'error')).toMatchObject({ message: expect.stringContaining('5 times in a row') });
    expect(provider.remaining).toBe(1);
    // Warned once, at the third.
    expect(sent(provider, 3)).toContain("You've made the same tool call three times");
  });

  it('counts the same arguments written in another order as the same call', async () => {
    const a = () => call('grep', { pattern: 'x', path: 'src' });
    const b = () => call('grep', { path: 'src', pattern: 'x' });
    const { agent } = setup([a(), b(), a(), b(), a(), say('never')]);
    expect((await collect(agent.run('search'))).at(-1)).toMatchObject({ reason: 'error' });
  });

  it('guides after three failed steps and stops after six', async () => {
    const miss = (n: number) => call('read_file', { path: `missing${n}.ts` });
    const { agent, provider } = setup([miss(1), miss(2), miss(3), miss(4), miss(5), miss(6), say('never')]);
    const events = await collect(agent.run('read them'));
    expect(sent(provider, 3)).toContain('The last 3 steps all failed');
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'error' });
    expect(events.find((e) => e.type === 'error')).toMatchObject({ message: expect.stringContaining('6 steps in a row') });
  });

  it('keeps nudging after progress, instead of running out of nudges early', async () => {
    const { agent, provider } = setup([
      say('Let me read the file:'),
      call('read_file', { path: 'src/app.ts' }),
      say('Now I will edit it:'),
      call('edit_file', { path: 'src/app.ts', old_string: 'const a = 1;', new_string: 'const a = 2;' }),
      say('Next I will check it:'),
      say('Done.'),
    ]);
    const events = await collect(agent.run('change a'));
    expect(events.at(-1)).toMatchObject({ reason: 'completed' });
    expect(provider.remaining).toBe(0);
  });
});

describe('finishing the plan', () => {
  it('sends the agent back once when it stops with open plan items', async () => {
    const { agent, provider } = setup([
      call('todo_write', { todos: [{ content: 'Write the page', status: 'completed' }, { content: 'Check on mobile', status: 'pending' }] }),
      say('All done.'),
      say('Checked on mobile too. Done.'),
    ]);
    const events = await collect(agent.run('build it'));
    const plan = provider.requests[2]!.messages.at(-1)!.content;
    expect(plan).toContain('Your plan still has 1 open item: "Check on mobile"');
    expect(events.at(-1)).toMatchObject({ reason: 'completed' });
    expect(provider.remaining).toBe(0);
  });
});

describe('the token estimate', () => {
  it('learns from what the provider reports', async () => {
    const provider = new ScriptedProvider([]);
    let n = 0;
    provider.stream = async function* (req) {
      n++;
      const size = JSON.stringify(req.messages).length + req.system.length;
      // The real tokenizer counts far more than characters over 3.5 suggests.
      yield { type: 'usage', usage: { inputTokens: Math.round((size / 3.5) * 2) + 2_000, outputTokens: 5 } };
      yield { type: 'done', message: n < 3 ? { role: 'assistant', content: '', toolCalls: [{ id: `c${n}`, name: 'glob', args: { pattern: `*${n}` } }] } : { role: 'assistant', content: 'ok' }, stopReason: n < 3 ? 'tool_use' : 'stop' };
    };
    const agent = new Agent({ router: new ModelRouter([{ provider, model: 'fake', contextWindow: 200_000 }]), workspace: new MemoryWorkspace({ '/a.ts': 'x' }), tools: fileTools(), systemPrompt: 'x'.repeat(4_000), permissions: new PermissionPolicy('auto') });
    const before = agent.contextTokens();
    await collect(agent.run('go'));
    expect(agent.contextTokens()).toBeGreaterThan(before * 1.2);
  });
});

describe('edits that are nearly right', () => {
  const run = async (file: string, old_string: string, new_string: string) => {
    const { agent } = setup([call('read_file', { path: 'a.py' }), call('edit_file', { path: 'a.py', old_string, new_string }), say('Done.')], { '/a.py': file });
    const events = await collect(agent.run('edit'));
    const end = events.filter((e) => e.type === 'tool_end').at(-1) as { result: { content: string; isError?: boolean } };
    return { result: end.result, file: await (agent.workspace as MemoryWorkspace).readFile('/a.py') };
  };

  it('applies an edit whose only difference is trailing spaces', async () => {
    const { result, file } = await run('x = 1   \ny = 2\n', 'x = 1\ny = 2', 'x = 10\ny = 2');
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('evening out trailing spaces');
    expect(file).toBe('x = 10\ny = 2\n');
  });

  it('applies an edit written with straight quotes over curly ones', async () => {
    const { result, file } = await run('msg = “hello” – world\n', 'msg = "hello" - world', 'msg = "hi"');
    expect(result.isError).toBeFalsy();
    expect(file).toBe('msg = "hi"\n');
  });

  it('shifts the replacement when every line is indented by the same amount', async () => {
    const source = 'def f():\n    if a:\n        return 1\n    return 2\n';
    const { result, file } = await run(source, 'if a:\n    return 1', 'if a:\n    return 3\nelse:\n    return 4');
    expect(result.content).toContain('evening out indentation');
    expect(file).toBe('def f():\n    if a:\n        return 3\n    else:\n        return 4\n    return 2\n');
  });

  it('refuses when the indentation differs unevenly, or more than one place fits', async () => {
    const uneven = await run('def f():\n    a = 1\n      b = 2\n', 'a = 1\nb = 2', 'a = 3');
    expect(uneven.result.isError).toBe(true);
    const twice = await run('a = 1  \nb\na = 1 \n', 'a = 1', 'a = 2');
    expect(twice.result.isError).toBe(true);
    expect(twice.file).toBe('a = 1  \nb\na = 1 \n');
  });
});
