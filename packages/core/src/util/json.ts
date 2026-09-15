/**
 * Tool-call argument parsing that survives what weaker models actually emit:
 * code fences around the JSON, raw newlines inside strings (very common when a
 * model writes a whole file into `content`), trailing commas, and arguments
 * that were JSON-encoded twice.
 */

export type ParsedArgs =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

export function parseToolArgs(raw: unknown): ParsedArgs {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ok: true, value: raw as Record<string, unknown> };
  }
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return { ok: true, value: {} };

  const unfenced = stripFences(text);
  const candidates = [text, unfenced, repairJson(unfenced)];
  let lastError = 'invalid JSON';
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate) as unknown;
      const obj = asObject(value);
      if (obj) return { ok: true, value: obj };
      lastError = 'arguments must be a JSON object';
    } catch (err) {
      lastError = (err as Error).message;
    }
  }
  return { ok: false, error: lastError };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  // Double-encoded: the arguments were a JSON string containing JSON.
  if (typeof value === 'string') {
    try {
      const inner = JSON.parse(value) as unknown;
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
        return inner as Record<string, unknown>;
      }
    } catch {
      // not double-encoded
    }
  }
  return null;
}

function stripFences(text: string): string {
  const m = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/.exec(text);
  return m ? m[1]!.trim() : text;
}

/**
 * One pass over the text that escapes raw control characters inside string
 * literals and drops trailing commas outside them.
 */
export function repairJson(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
      } else if (ch === '\\') {
        out += ch;
        escaped = true;
      } else if (ch === '"') {
        out += ch;
        inString = false;
      } else if (ch === '\n') {
        out += '\\n';
      } else if (ch === '\r') {
        out += '\\r';
      } else if (ch === '\t') {
        out += '\\t';
      } else if (ch.charCodeAt(0) < 0x20) {
        out += '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
      } else {
        out += ch;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === ',') {
      // Drop the comma if the next non-space character closes a container.
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j]!)) j++;
      if (text[j] !== '}' && text[j] !== ']') out += ch;
    } else {
      out += ch;
    }
  }
  return out;
}
