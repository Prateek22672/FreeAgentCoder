import type { Message, ToolCall } from '../types';

/**
 * What is sent to the model, as opposed to what is kept. The conversation
 * keeps every tool result in full (for the transcript, undo and compaction);
 * each request carries a lighter copy:
 *
 * - Tool results are cut to a size that is useful to read: 8,000 characters
 *   for the latest two steps, 4,000 for older ones, keeping the start and
 *   the end (where errors and summaries are), with a note on how to see more.
 * - A file read is replaced by a short note once the file has been read again
 *   or changed: the newer content is in the conversation, and the old copy
 *   would be paid for on every remaining step.
 *
 * Every step resends the whole conversation, so this is where most tokens on
 * small tasks are saved. Learned from Cline's message builder.
 */

export const RECENT_RESULT_CHARS = 8_000;
export const OLD_RESULT_CHARS = 4_000;
/** Steps whose results count as recent. */
const RECENT_STEPS = 2;

const READS = new Set(['read_file']);
const WRITES = new Set(['write_file', 'edit_file']);

function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.3);
  const tail = max - head;
  const omitted = text.length - head - tail;
  return `${text.slice(0, head)}\n\n… [${omitted} characters left out to save tokens; read a narrower range with offset and limit, or narrow the search] …\n\n${text.slice(text.length - tail)}`;
}

function pathOf(call: ToolCall | undefined): string | undefined {
  const path = call?.args.path;
  return typeof path === 'string' ? path.trim().replace(/\\/g, '/').replace(/^\.\//, '') : undefined;
}

export function requestView(messages: Message[]): Message[] {
  // Which call produced each result, and the order of steps.
  const calls = new Map<string, ToolCall>();
  const stepOf = new Map<string, number>();
  let step = 0;
  for (const m of messages) {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      step++;
      for (const c of m.toolCalls) {
        calls.set(c.id, c);
        stepOf.set(c.id, step);
      }
    }
  }
  const lastStep = step;

  // For each file, the step of its newest read or change.
  const newest = new Map<string, number>();
  for (const m of messages) {
    if (m.role !== 'tool' || m.isError) continue;
    const call = calls.get(m.toolCallId);
    const path = pathOf(call);
    // A read of only part of a file does not stand in for an earlier read of more of it.
    const whole = WRITES.has(m.name) || (READS.has(m.name) && call?.args.offset === undefined && call?.args.limit === undefined);
    if (path && whole) newest.set(path, Math.max(newest.get(path) ?? 0, stepOf.get(m.toolCallId) ?? 0));
  }

  let changed = false;
  const out = messages.map((m) => {
    if (m.role !== 'tool') return m;
    const at = stepOf.get(m.toolCallId) ?? lastStep;
    const path = pathOf(calls.get(m.toolCallId));
    if (READS.has(m.name) && !m.isError && path && (newest.get(path) ?? 0) > at) {
      changed = true;
      return { ...m, content: `[Outdated: ${path} was read again or changed later; the newer content is further down.]` };
    }
    const max = lastStep - at < RECENT_STEPS ? RECENT_RESULT_CHARS : OLD_RESULT_CHARS;
    if (m.content.length <= max) return m;
    changed = true;
    return { ...m, content: cut(m.content, max) };
  });
  return changed ? out : messages;
}
