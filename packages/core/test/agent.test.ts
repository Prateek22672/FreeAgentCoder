import { describe, expect, it } from 'vitest';
import { Agent } from '../src/agent/agent';
import { PermissionPolicy, type ApprovalRequest } from '../src/agent/permissions';
import { ModelRouter } from '../src/providers/router';
import { fileTools } from '../src/tools/index';
import type { Message, ToolMessage } from '../src/types';
import { MemoryWorkspace } from '../src/workspace/memory';
import { call, calls, collect, say, ScriptedProvider, type Step } from './helpers';

function setup(script: Step[], opts: { mode?: 'ask' | 'auto-edit' | 'auto'; approve?: (r: ApprovalRequest) => Promise<{ allow: boolean; feedback?: string }>; maxContextTokens?: number; files?: Record<string, string> } = {}) {
  const provider = new ScriptedProvider(script);
  const ws = new MemoryWorkspace(opts.files ?? { '/src/app.ts': 'const greeting = "hello";\nconsole.log(greeting);\n' });
  const agent = new Agent({
    router: new ModelRouter([{ provider, model: 'fake', contextWindow: 200_000 }]),
    workspace: ws,
    tools: fileTools(),
    systemPrompt: 'test',
    permissions: new PermissionPolicy(opts.mode ?? 'auto-edit'),
    approve: opts.approve as never,
    maxContextTokens: opts.maxContextTokens,
  });
  return { provider, ws, agent };
}

/** Every tool call in history must have exactly one result right after it (providers reject anything else). */
function assertValidHistory(messages: Message[]) {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role !== 'assistant' || !m.toolCalls?.length) continue;
    const results = messages.slice(i + 1, i + 1 + m.toolCalls.length) as ToolMessage[];
    expect(results.map((r) => r.role)).toEqual(m.toolCalls.map(() => 'tool'));
    expect(results.map((r) => r.toolCallId)).toEqual(m.toolCalls.map((c) => c.id));
  }
}

describe('Agent loop', () => {
  it('reads, edits and reports back', async () => {
    const { agent, ws, provider } = setup([
      call('read_file', { path: 'src/app.ts' }),
      call('edit_file', { path: 'src/app.ts', old_string: '"hello"', new_string: '"hi there"' }),
      say('Changed the greeting in src/app.ts:1.'),
    ]);
    const events = await collect(agent.run('Change the greeting to "hi there"'));
    expect(await ws.readFile('/src/app.ts')).toContain('"hi there"');
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'completed', steps: 3 });
    expect(events.filter((e) => e.type === 'tool_end')).toHaveLength(2);
    expect(provider.remaining).toBe(0);
    assertValidHistory(agent.messages);
    // The model saw the tool result of its read before editing.
    const second = provider.requests[1]!.messages;
    expect((second.at(-1) as ToolMessage).content).toContain('1\tconst greeting');
  });

  it('asks for approval and passes the user feedback back when declined', async () => {
    const asked: ApprovalRequest[] = [];
    const { agent, ws, provider } = setup(
      [call('write_file', { path: 'notes.md', content: '# Notes' }), say('Okay, I will not create it.')],
      {
        mode: 'ask',
        approve: async (r) => {
          asked.push(r);
          return { allow: false, feedback: 'not now' };
        },
      },
    );
    const events = await collect(agent.run('make notes'));
    expect(asked[0]).toMatchObject({ tool: 'write_file', reason: 'changes files' });
    expect(asked[0]!.preview).toMatchObject({ type: 'diff', created: true, after: '# Notes' });
    expect(await ws.stat('/notes.md')).toBeNull();
    const result = provider.requests[1]!.messages.at(-1) as ToolMessage;
    expect(result.content).toContain('declined');
    expect(result.content).toContain('not now');
    expect(events.some((e) => e.type === 'tool_end' && e.denied)).toBe(true);
  });

  it('never asks the user to approve an edit that would fail anyway', async () => {
    let asked = 0;
    const { agent } = setup([call('edit_file', { path: 'src/app.ts', old_string: 'nope', new_string: 'x' }), say('done')], {
      mode: 'ask',
      approve: async () => {
        asked++;
        return { allow: true };
      },
    });
    await collect(agent.run('edit'));
    expect(asked).toBe(0);
  });

  it('turns bad calls into helpful tool errors instead of crashing', async () => {
    const { agent, provider } = setup([
      calls([
        ['no_such_tool', {}],
        ['read_file', {}],
      ]),
      say('ok'),
    ]);
    await collect(agent.run('x'));
    const msgs = provider.requests[1]!.messages;
    expect((msgs.at(-2) as ToolMessage).content).toContain('Unknown tool "no_such_tool"');
    expect((msgs.at(-1) as ToolMessage).content).toContain('missing required parameter "path"');
    assertValidHistory(agent.messages);
  });

  it('nudges a model that announces an action but does not act', async () => {
    const { agent, ws, provider } = setup([
      say('I found it. Let me update the file now.'),
      call('write_file', { path: 'out.txt', content: 'done' }),
      say('Created out.txt.'),
    ]);
    const events = await collect(agent.run('create out.txt'));
    expect(await ws.readFile('/out.txt')).toBe('done');
    expect(provider.requests[1]!.messages.at(-1)).toMatchObject({ role: 'user', synthetic: true });
    expect(events.at(-1)).toMatchObject({ reason: 'completed' });
  });

  it('breaks out of a loop of identical calls', async () => {
    const same = () => call('read_file', { path: 'src/app.ts' });
    const { agent, provider } = setup([same(), same(), same(), say('I am stuck on X.')]);
    await collect(agent.run('loop'));
    const last = provider.requests[3]!.messages.at(-1)!;
    expect(last).toMatchObject({ role: 'user', synthetic: true });
    expect(last.content).toContain('same tool call three times');
  });

  it('recovers tool calls written as text by weak models', async () => {
    const { agent, ws } = setup([
      () => ({ role: 'assistant', content: '<tool_call>{"name":"write_file","arguments":{"path":"a.txt","content":"A"}}</tool_call>' }),
      say('done'),
    ]);
    await collect(agent.run('write a.txt'));
    expect(await ws.readFile('/a.txt')).toBe('A');
  });

  it('keeps history valid when interrupted between tool calls', async () => {
    const controller = new AbortController();
    const { agent } = setup(
      [
        calls([
          ['write_file', { path: 'a.txt', content: 'A' }],
          ['write_file', { path: 'b.txt', content: 'B' }],
        ]),
      ],
      {
        mode: 'ask',
        approve: async () => {
          controller.abort();
          return { allow: true };
        },
      },
    );
    const events = await collect(agent.run('two files', { signal: controller.signal }));
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'aborted' });
    assertValidHistory(agent.messages);
    expect((agent.messages.at(-1) as ToolMessage).content).toContain('interrupted');
  });

  it('undo reverts the last turn and tells the model', async () => {
    const { agent, ws } = setup([call('write_file', { path: 'new.txt', content: 'x' }), say('made it')]);
    await collect(agent.run('make new.txt'));
    expect(await ws.stat('/new.txt')).not.toBeNull();
    const result = await agent.undo();
    expect(result?.deleted).toEqual(['/new.txt']);
    expect(await ws.stat('/new.txt')).toBeNull();
    expect(agent.messages.at(-1)!.content).toContain('reverted');
  });

  it('compacts automatically mid-task when the context outgrows the limit', async () => {
    let summaryRequest: { tools: unknown[]; text: string } | undefined;
    const { agent, provider } = setup(
      [
        call('read_file', { path: 'big.txt' }),
        (req) => {
          summaryRequest = { tools: req.tools, text: req.messages[0]!.content };
          return { role: 'assistant', content: 'SUMMARY: the user asked to inspect big.txt; it was read.' };
        },
        say('Done after compaction.'),
      ],
      { maxContextTokens: 8_000, files: { '/big.txt': `${'x'.repeat(79)}\n`.repeat(400) } },
    );
    const events = await collect(agent.run('inspect big.txt'));
    expect(events.some((e) => e.type === 'compacted' && e.kind === 'summary')).toBe(true);
    expect(summaryRequest?.tools).toEqual([]);
    expect(summaryRequest?.text).toContain('USER: inspect big.txt');
    const last = provider.requests.at(-1)!;
    expect(last.messages).toHaveLength(1);
    expect(last.messages[0]!.content).toContain('SUMMARY: the user asked to inspect big.txt');
    expect(last.messages[0]!.content).toContain('inspect big.txt'); // the request, verbatim
    expect(events.at(-1)).toMatchObject({ reason: 'completed' });
    assertValidHistory(agent.messages);
  });

  it('/compact summarizes on demand and keeps recent messages', async () => {
    const { agent } = setup([
      say('Hello! How can I help?'),
      say('Sure.'),
      () => ({ role: 'assistant', content: 'SUMMARY: greetings exchanged.' }),
    ]);
    await collect(agent.run('hi'));
    await collect(agent.run('thanks'));
    const events = await collect(agent.compact());
    expect(events.at(-1)).toMatchObject({ type: 'compacted', kind: 'summary' });
    expect(agent.messages[0]).toMatchObject({ role: 'user', synthetic: true });
    expect(agent.messages[0]!.content).toContain('SUMMARY: greetings exchanged.');
    expect(agent.messages.at(-1)!.content).toBe('Sure.');
  });

  it('pauses at the step limit', async () => {
    const provider = new ScriptedProvider([call('list_dir', {}), call('glob', { pattern: '*.ts' }), say('never reached')]);
    const agent = new Agent({
      router: new ModelRouter([{ provider, model: 'fake', contextWindow: 100_000 }]),
      workspace: new MemoryWorkspace({ '/a.ts': '' }),
      tools: fileTools(),
      systemPrompt: 't',
      maxSteps: 2,
    });
    const events = await collect(agent.run('go'));
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'max_steps' });
  });
});
