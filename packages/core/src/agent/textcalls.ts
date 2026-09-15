import { cleanToolName } from '../providers/openai';
import type { ToolCall } from '../types';
import { toolCallId } from '../util/ids';
import { parseToolArgs } from '../util/json';

/**
 * Some models (small local ones especially) "call" tools by writing the call
 * into their reply instead of using the API's tool-calling channel:
 *   <tool_call>{"name": "read_file", "arguments": {"path": "a.ts"}}</tool_call>
 *   <function=read_file>{"path": "a.ts"}</function>
 *   ```json {"name": "read_file", "arguments": {...}} ```
 * We recover those so the agent still works, but only for known tool names.
 */
export function extractTextToolCalls(
  text: string,
  toolNames: Set<string>,
): { text: string; calls: ToolCall[] } | null {
  if (!text || !/[<{]/.test(text)) return null;
  const calls: ToolCall[] = [];
  let rest = text;

  rest = rest.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g, (whole, body: string) => {
    const call = fromJson(body, toolNames);
    if (!call) return whole;
    calls.push(call);
    return '';
  });

  rest = rest.replace(/<function=([\w.-]+)>\s*([\s\S]*?)\s*<\/function>/g, (whole, name: string, body: string) => {
    const clean = cleanToolName(name);
    const args = parseToolArgs(body);
    if (!toolNames.has(clean) || !args.ok) return whole;
    calls.push({ id: toolCallId(), name: clean, args: args.value });
    return '';
  });

  if (!calls.length) {
    const trimmed = rest.trim();
    const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
    const candidate = fenced ? fenced[1]!.trim() : trimmed;
    if (candidate.startsWith('{') && candidate.endsWith('}')) {
      const call = fromJson(candidate, toolNames);
      if (call) {
        calls.push(call);
        rest = '';
      }
    }
  }
  return calls.length ? { text: rest.trim(), calls } : null;
}

function fromJson(body: string, toolNames: Set<string>): ToolCall | null {
  const parsed = parseToolArgs(body);
  if (!parsed.ok) return null;
  const obj = parsed.value;
  const fn = obj.function as Record<string, unknown> | undefined;
  const rawName = obj.name ?? obj.tool ?? obj.tool_name ?? fn?.name;
  if (typeof rawName !== 'string') return null;
  const name = cleanToolName(rawName);
  if (!toolNames.has(name)) return null;
  let args = obj.arguments ?? obj.parameters ?? obj.args ?? obj.input ?? fn?.arguments ?? {};
  if (typeof args === 'string') {
    const inner = parseToolArgs(args);
    if (!inner.ok) return null;
    args = inner.value;
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  return { id: toolCallId(), name, args: args as Record<string, unknown> };
}
