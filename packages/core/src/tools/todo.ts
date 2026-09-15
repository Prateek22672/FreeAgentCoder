import type { Todo } from '../types';
import type { Tool } from './types';

interface Args {
  todos: Todo[];
}

function normalizeStatus(status: unknown): Todo['status'] {
  const s = String(status ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  if (['completed', 'complete', 'done', 'finished', 'success'].includes(s)) return 'completed';
  if (['in_progress', 'inprogress', 'active', 'doing', 'started', 'working'].includes(s)) return 'in_progress';
  return 'pending';
}

export const todoWriteTool: Tool<Args> = {
  name: 'todo_write',
  description:
    'Record your plan for multi-step work. Send the COMPLETE list every time; it replaces the previous one. Keep exactly one item in_progress while you work on it and mark items completed as soon as they are done.',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'What needs doing, in a few words' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          },
          required: ['content', 'status'],
        },
      },
    },
    required: ['todos'],
  },
  kind: 'meta',
  normalize(args) {
    let todos = args.todos;
    if (typeof todos === 'string') {
      try {
        todos = JSON.parse(todos);
      } catch {
        return args;
      }
    }
    if (!Array.isArray(todos)) return args;
    return {
      ...args,
      todos: todos.map((t) => {
        if (typeof t === 'string') return { content: t, status: 'pending' };
        const item = (t ?? {}) as Record<string, unknown>;
        return {
          content: String(item.content ?? item.task ?? item.title ?? item.description ?? ''),
          status: normalizeStatus(item.status ?? item.state),
        };
      }),
    };
  },
  label: () => 'Update plan',
  async prepare(args, ctx) {
    return {
      run: async () => {
        const todos = args.todos.filter((t) => t.content.trim());
        ctx.todos.set(todos);
        const done = todos.filter((t) => t.status === 'completed').length;
        const current = todos.find((t) => t.status === 'in_progress');
        return {
          content: `Plan updated: ${done}/${todos.length} done${current ? `; now working on: ${current.content}` : ''}.`,
          summary: `${done}/${todos.length} done`,
          display: { type: 'todos', todos },
        };
      },
    };
  },
};
