import type { Message } from '../types';
import { estimateTokens, truncateMiddle } from '../util/text';

/**
 * Context management. Two stages, cheapest first:
 *  1. micro-compaction: blank out bulky OLD tool outputs and file contents
 *     inside old tool calls (the model can always re-read). No model call.
 *  2. summary compaction: have a model summarize the session and continue
 *     from that summary plus the last few messages.
 * Both edit history, so provider echo data (Claude thinking blocks, Gemini
 * signatures) is dropped at the same time — replaying it against an edited
 * history is invalid.
 */

const BULKY_ARGS = ['content', 'new_string', 'old_string'];

export function microCompact(messages: Message[], keepRecentTools = 6): number {
  let saved = 0;
  let toolSeen = 0;
  let assistantSeen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === 'tool') {
      toolSeen++;
      if (toolSeen > keepRecentTools && m.content.length > 400) {
        const note = `[Earlier ${m.name} output removed to save context. Run the tool again if you need it.]`;
        saved += estimateTokens(m.content) - estimateTokens(note);
        m.content = note;
      }
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      assistantSeen++;
      if (assistantSeen <= 2) continue;
      for (const call of m.toolCalls) {
        for (const key of BULKY_ARGS) {
          const value = call.args[key];
          if (typeof value === 'string' && value.length > 400) {
            const note = `[${value.length} characters omitted]`;
            saved += estimateTokens(value) - estimateTokens(note);
            call.args[key] = note;
          }
        }
      }
    }
  }
  return saved;
}

export function dropEchoes(messages: Message[]): void {
  for (const m of messages) if (m.role === 'assistant') delete m.echo;
}

/**
 * Split off the tail to keep verbatim. The tail never starts with a tool
 * result (its tool call would be missing) and stays under `maxTokens`.
 */
export function splitTail(messages: Message[], maxTokens: number, maxMessages = 6): { head: Message[]; tail: Message[] } {
  let start = messages.length;
  let tokens = 0;
  while (start > 0 && messages.length - start < maxMessages) {
    const m = messages[start - 1]!;
    const cost = estimateTokens(m.content) + (m.role === 'assistant' && m.toolCalls ? estimateTokens(JSON.stringify(m.toolCalls)) : 0);
    if (tokens + cost > maxTokens) break;
    tokens += cost;
    start--;
  }
  while (start < messages.length && messages[start]!.role === 'tool') start++;
  return { head: messages.slice(0, start), tail: messages.slice(start) };
}

/** The session as plain text, for the summarizer (works with every provider, no tool schemas needed). */
export function transcript(messages: Message[], maxChars: number): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      lines.push(`${m.synthetic ? 'NOTE' : 'USER'}: ${m.content}`);
    } else if (m.role === 'assistant') {
      if (m.content) lines.push(`ASSISTANT: ${m.content}`);
      for (const call of m.toolCalls ?? []) {
        lines.push(`  -> ${call.name} ${truncateMiddle(JSON.stringify(call.args), 300, 0.7)}`);
      }
    } else {
      lines.push(`  <- ${m.name}${m.isError ? ' (error)' : ''}: ${truncateMiddle(m.content, 700, 0.5)}`);
    }
  }
  return truncateMiddle(lines.join('\n'), maxChars, 0.3);
}

export const SUMMARY_SYSTEM =
  'You condense coding-agent sessions into a handoff summary so the work can continue without the transcript. Be accurate and specific; never invent details.';

export const SUMMARY_INSTRUCTIONS = `Summarize the session above for the agent that will continue it. Cover:
1. The user's goals and every explicit requirement, preference or constraint.
2. Key decisions made and why.
3. Files created or changed (paths) and what changed in each.
4. Current state: what works, what is broken, errors seen, and the exact commands used to build, run or test.
5. What remains to be done, in order.
Be specific (paths, names, commands, versions). Plain text, under 500 words.`;

/** Mechanical fallback when no model is available to summarize. */
export function fallbackSummary(messages: Message[]): string {
  const requests = messages.filter((m) => m.role === 'user' && !m.synthetic).map((m) => `- ${truncateMiddle(m.content, 300)}`);
  const touched = new Set<string>();
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    for (const c of m.toolCalls ?? []) {
      if (['write_file', 'edit_file'].includes(c.name) && typeof c.args.path === 'string') touched.add(c.args.path);
    }
  }
  const lastReply = [...messages].reverse().find((m) => m.role === 'assistant' && m.content)?.content ?? '';
  return [
    'User requests so far:',
    ...requests,
    touched.size ? `Files changed: ${[...touched].join(', ')}` : 'No files changed yet.',
    lastReply ? `Last assistant message: ${truncateMiddle(lastReply, 600)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function compactionMessage(summary: string, latestRequest: string | undefined): string {
  return [
    '[Earlier conversation was compacted to save context. Summary of the session so far:]',
    summary.trim(),
    latestRequest ? `\n[The user's most recent request, verbatim:]\n${latestRequest}` : '',
    '\nContinue from where you left off. File contents you read earlier are no longer in context: re-read files before editing them.',
  ]
    .filter(Boolean)
    .join('\n');
}
