import type { JsonSchema } from '../types';

/**
 * Lenient argument validation. Weaker models routinely send numbers as
 * strings, `null` for optional fields, or Claude-style names like `file_path`
 * for our `path` — rejecting those wastes a round trip, so we coerce what is
 * unambiguous and only error on what is genuinely wrong.
 */

const ALIASES: Record<string, string[]> = {
  path: ['file_path', 'filepath', 'file', 'filename', 'file_name', 'directory', 'dir'],
  content: ['contents', 'text', 'file_content', 'file_text', 'new_content', 'data'],
  old_string: ['old_str', 'oldString', 'old_text', 'oldText', 'search', 'find', 'old'],
  new_string: ['new_str', 'newString', 'new_text', 'newText', 'replace', 'replacement', 'new'],
  command: ['cmd', 'shell_command', 'script'],
  pattern: ['regex', 'query', 'glob_pattern'],
};

export interface Validated {
  value: Record<string, unknown>;
  errors: string[];
}

export function validateArgs(schema: JsonSchema, input: Record<string, unknown>): Validated {
  const props = schema.properties ?? {};
  const args = { ...input };

  for (const [target, aliases] of Object.entries(ALIASES)) {
    if (!(target in props) || args[target] !== undefined) continue;
    const alias = aliases.find((a) => args[a] !== undefined && !(a in props));
    if (alias) {
      args[target] = args[alias];
      delete args[alias];
    }
  }

  const value: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const [key, raw] of Object.entries(args)) {
    const prop = props[key];
    if (!prop) continue; // unknown keys are ignored
    const result = coerce(raw, prop, key);
    if (result.error) errors.push(result.error);
    else if (result.value !== undefined) value[key] = result.value;
  }
  for (const key of schema.required ?? []) {
    if (value[key] === undefined && !errors.some((e) => e.includes(`"${key}"`))) {
      errors.push(`missing required parameter "${key}"`);
    }
  }
  return { value, errors };
}

function types(schema: JsonSchema): string[] {
  if (!schema.type) return [];
  return Array.isArray(schema.type) ? schema.type : [schema.type];
}

function coerce(raw: unknown, schema: JsonSchema, key: string): { value?: unknown; error?: string } {
  if (raw === null || raw === undefined) return {};
  const allowed = types(schema);
  let value: unknown = raw;

  if (allowed.length && !allowed.some((t) => matches(value, t))) {
    const converted = convert(value, allowed);
    if (converted === undefined) {
      return { error: `"${key}" should be ${allowed.join(' or ')}, got ${describe(raw)}` };
    }
    value = converted;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    return { error: `"${key}" must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}` };
  }

  if (Array.isArray(value) && schema.items) {
    const items: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (schema.items.properties && item && typeof item === 'object' && !Array.isArray(item)) {
        const inner = validateArgs(schema.items, item as Record<string, unknown>);
        if (inner.errors.length) return { error: `"${key}[${i}]": ${inner.errors.join('; ')}` };
        items.push(inner.value);
      } else {
        const inner = coerce(item, schema.items, `${key}[${i}]`);
        if (inner.error) return inner;
        items.push(inner.value);
      }
    }
    value = items;
  }
  return { value };
}

function matches(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return !!value && typeof value === 'object' && !Array.isArray(value);
    default:
      return true;
  }
}

function convert(value: unknown, allowed: string[]): unknown {
  for (const type of allowed) {
    switch (type) {
      case 'string':
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value.join('\n');
        break;
      case 'integer':
      case 'number': {
        const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
        if (Number.isFinite(n)) return type === 'integer' ? Math.trunc(n) : n;
        if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
        break;
      }
      case 'boolean':
        if (value === 'true' || value === 1 || value === '1') return true;
        if (value === 'false' || value === 0 || value === '0') return false;
        break;
      case 'array':
      case 'object':
        if (typeof value === 'string') {
          try {
            const parsed = JSON.parse(value) as unknown;
            if (matches(parsed, type)) return parsed;
          } catch {
            // not JSON
          }
        }
        break;
    }
  }
  return undefined;
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return 'an array';
  if (value === null) return 'null';
  return typeof value === 'object' ? 'an object' : `${typeof value} ${JSON.stringify(value).slice(0, 40)}`;
}
