import { describe, expect, it } from 'vitest';
import { Agent, errorSignature } from '../src/agent/agent';
import { PermissionPolicy } from '../src/agent/permissions';
import { ModelRouter, type RouterEntry } from '../src/providers/router';
import { fileTools } from '../src/tools/index';
import { MemoryWorkspace } from '../src/workspace/memory';
import { call, collect, say, ScriptedProvider } from './helpers';

const TRACE = (line: number, value: string) => `Traceback (most recent call last):
  File "c:\\Users\\me\\Desktop\\py\\build_nepal_floods_pptx.py", line ${line}, in <module>
    fig_overview()
ValueError: (${value}) is not a valid value for color: supported inputs are (r, g, b)
exit 1`;

describe('errorSignature', () => {
  it('recognises the same exception with different lines, values and paths', () => {
    expect(errorSignature('run_command', TRACE(72, '27, 42, 51'))).toBe(errorSignature('run_command', TRACE(91, '192, 57, 43')));
    expect(errorSignature('run_command', TRACE(72, '1, 2, 3'))).toContain('ValueError');
  });

  it('tells different errors apart', () => {
    expect(errorSignature('run_command', TRACE(1, '1, 2, 3'))).not.toBe(errorSignature('run_command', "NameError: name 'cats' is not defined"));
  });
});

describe('a repeated error', () => {
  it('is diagnosed on a strong model, not the fallback', async () => {
    const steps = [
      call('read_file', { path: 'src/missing.ts' }),
      call('read_file', { path: 'src/app.ts' }),
      call('read_file', { path: 'src/missing.ts' }),
      say('Found it.'),
    ];
    const strong = new ScriptedProvider(steps, 'strong');
    const weak = new ScriptedProvider([say('weak model answered')], 'weak');
    const entries: RouterEntry[] = [
      { provider: weak, model: 'free-router', contextWindow: 200_000, fallback: true },
      { provider: strong, model: 'good', contextWindow: 200_000 },
    ];
    const agent = new Agent({
      router: new ModelRouter(entries),
      workspace: new MemoryWorkspace({ '/src/app.ts': 'const a = 1;\n' }),
      tools: fileTools(),
      systemPrompt: 'test',
      permissions: new PermissionPolicy('auto'),
    });
    const events = await collect(agent.run('fix it'));
    expect(weak.requests).toHaveLength(0);
    expect(strong.requests.at(-1)?.strong).toBe(true);
    expect(events.some((e) => e.type === 'notice' && /same error came back/.test(e.message))).toBe(true);
    expect(agent.messages.some((m) => m.role === 'user' && m.synthetic && m.content.startsWith('The same error has now happened twice'))).toBe(true);
  });
});

describe('the task token limit', () => {
  function agentWith(script: ReturnType<typeof call>[]) {
    const agent = new Agent({
      router: new ModelRouter([{ provider: new ScriptedProvider(script), model: 'm', contextWindow: 200_000 }]),
      workspace: new MemoryWorkspace({ '/src/app.ts': 'const a = 1;\n' }),
      tools: fileTools(),
      systemPrompt: 'test',
      permissions: new PermissionPolicy('auto'),
      maxTurnTokens: 1,
    });
    return agent;
  }

  it('lets a task that is still changing files run on once', async () => {
    const agent = agentWith([
      call('write_file', { path: 'src/one.ts', content: 'export const one = 1;\n' }),
      call('write_file', { path: 'src/two.ts', content: 'export const two = 2;\n' }),
      say('Done.'),
    ]);
    const events = await collect(agent.run('change a'));
    expect(events.some((e) => e.type === 'notice' && /still making progress/.test(e.message))).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'budget' });
  });

  it('pauses a task that is only reading', async () => {
    const agent = agentWith([call('read_file', { path: 'src/app.ts' }), call('read_file', { path: 'src/app.ts' }), say('Done.')]);
    const events = await collect(agent.run('look'));
    expect(events.some((e) => e.type === 'notice' && /still making progress/.test(e.message))).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'budget', steps: 1 });
  });
});
