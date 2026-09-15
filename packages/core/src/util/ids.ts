const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function randomId(length = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const b of bytes) out += ALNUM[b % ALNUM.length];
  return out;
}

/**
 * Tool-call ids are re-minted by us instead of kept from the provider, because
 * a conversation can move between providers and they disagree on the format:
 * Mistral only accepts exactly 9 alphanumerics, Anthropic only [a-zA-Z0-9_-].
 * 9 alphanumerics satisfies everyone.
 */
export function toolCallId(): string {
  return randomId(9);
}
