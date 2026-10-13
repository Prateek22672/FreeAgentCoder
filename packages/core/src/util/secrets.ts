/**
 * Hides secrets from what the model reads: API keys, tokens, private keys and
 * secret-looking assignments in files and command output are replaced with a
 * marker before they are sent to any provider. A protective layer, not a
 * guarantee: unusual formats can slip through.
 *
 * The real values stay in the files. Edits that would write the marker back
 * into a file are refused, so a hidden secret is never overwritten.
 */

export const SECRET_MARKER = '[secret hidden by CROCS]';

const PATTERNS: RegExp[] = [
  // Private key blocks.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // Provider keys with a known shape.
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g, // OpenAI, Anthropic
  /\bgsk_[A-Za-z0-9]{20,}/g, // Groq
  /\bnvapi-[A-Za-z0-9_-]{20,}/g, // NVIDIA
  /\bsk-or-v1-[A-Za-z0-9]{20,}/g, // OpenRouter
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/g, // GitHub
  /\bglpat-[A-Za-z0-9_-]{20,}/g, // GitLab
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, // AWS access key id
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/g, // Stripe
  /\bhf_[A-Za-z0-9]{30,}/g, // Hugging Face
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  // Passwords inside connection strings: scheme://user:password@host
  /(?<=\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]{3,}(?=@)/gi,
];

/** NAME=value or "name": "value" where the name says it is a secret and the value is a literal. */
const ASSIGNMENT =
  /(\b[A-Za-z0-9_.-]*(?:secret|token|password|passwd|api[_-]?key|apikey|private[_-]?key|access[_-]?key|client[_-]?secret)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?)([A-Za-z0-9_\-+/=~]{8,})(?=["']?\s*(?:[,;}\n\r]|$))/gi;

/** A literal secret has a digit and is not a word, a placeholder or a reference to another variable. */
function looksLiteral(value: string): boolean {
  return /\d/.test(value) && /[A-Za-z]/.test(value) && !/^(?:your|xxx|changeme|example|placeholder|process|env)/i.test(value);
}

export function hideSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  for (const pattern of PATTERNS) out = out.replace(pattern, SECRET_MARKER);
  out = out.replace(ASSIGNMENT, (whole, name: string, value: string) => (looksLiteral(value) ? `${name}${SECRET_MARKER}` : whole));
  return out;
}

/** Whether a write would put the marker into a file in place of a real secret. */
export function writesHiddenSecret(args: Record<string, unknown>): boolean {
  return ['content', 'new_string'].some((field) => typeof args[field] === 'string' && (args[field] as string).includes(SECRET_MARKER));
}
