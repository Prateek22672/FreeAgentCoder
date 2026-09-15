import type { ImagePart, Message, UserMessage } from '../types';

/**
 * Image attachments. Vision-capable models get the actual images; every other
 * model gets the text plus a short placeholder, so an attachment never makes a
 * request fail.
 */

/** Rough context cost of one attached image, used for budgeting and compaction. */
export const IMAGE_TOKEN_ESTIMATE = 1_000;

const MIME_TYPES = new Set<ImagePart['mimeType']>(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * Whether `model` on `provider` accepts image input. Unknown providers
 * (including custom endpoints) are assumed text-only.
 */
export function modelSupportsImages(provider: string, model: string): boolean {
  const p = provider.toLowerCase();
  const m = model.toLowerCase().replace(/^models\//, '');
  switch (p) {
    case 'gemini':
      return /^gemini-/.test(m) || isGemma3Plus(m);
    case 'anthropic':
      return /^claude-/.test(m);
    case 'openai':
      if (/audio|realtime|transcribe|tts/.test(m) || /^o3-mini/.test(m)) return false;
      return /^(gpt-4o|gpt-4\.1|gpt-5|o3|o4)/.test(m);
    case 'groq':
      return /^meta-llama\/llama-4-/.test(m);
    case 'mistral':
      return /^(pixtral|mistral-small|mistral-medium|magistral)/.test(m);
    case 'openrouter':
      if (m === 'openrouter/free') return false;
      return (
        /gemini|claude|gpt-4o|gpt-4\.1|gpt-5|llama-4|pixtral|qwen[^/]*vl|-vl|vision/.test(m) || isGemma3Plus(m)
      );
    default:
      return false;
  }
}

/** Gemma 3 and later see images, except the tiny text-only 1B model. */
function isGemma3Plus(model: string): boolean {
  const match = /gemma-?(\d+)/.exec(model);
  return !!match && Number(match[1]) >= 3 && !/[-:]1b\b/.test(model);
}

/** "2 images (screen.png, error.png)" */
export function describeImages(images: readonly ImagePart[]): string {
  const names = images.map((img) => img.name?.trim()).filter((n): n is string => !!n);
  const count = `${images.length} image${images.length === 1 ? '' : 's'}`;
  return names.length ? `${count} (${names.join(', ')})` : count;
}

/** Text sent in place of the images to a model that can't view them. */
export function imagePlaceholder(images: readonly ImagePart[]): string {
  const names = images.map((img) => img.name?.trim()).filter((n): n is string => !!n);
  const count = `${images.length} image${images.length === 1 ? '' : 's'} attached`;
  return `[${names.length ? `${count} (${names.join(', ')})` : count} — this model can't view images; rely on the description in the message.]`;
}

/** Images on a message that can actually be sent (saved sessions keep names, not data). */
export function sendableImages(message: Message): ImagePart[] {
  if (message.role !== 'user' || !message.images?.length) return [];
  return message.images.filter((img) => !!img.data);
}

export function imageDataUrl(image: ImagePart): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

/** Token estimate for a message's attachments. */
export function imageTokens(message: Message): number {
  return message.role === 'user' && message.images?.length ? message.images.length * IMAGE_TOKEN_ESTIMATE : 0;
}

/**
 * Accepts `data:` URLs as well as raw base64 and fixes the mime type from the
 * URL when it is one of the supported ones.
 */
export function normalizeImage(image: ImagePart): ImagePart {
  const match = /^data:([^;,]+)(?:;[^,]*)?,/.exec(image.data);
  if (!match) return { ...image };
  const mime = match[1]!.toLowerCase() as ImagePart['mimeType'];
  return { ...image, mimeType: MIME_TYPES.has(mime) ? mime : image.mimeType, data: image.data.slice(match[0].length) };
}

/**
 * Remove the attachments from a user message, leaving a note with their names
 * in its text. Returns the message unchanged when it has none.
 */
export function withoutImages(message: UserMessage, note = 'attached'): UserMessage {
  if (!message.images?.length) return message;
  const { images, ...rest } = message;
  const marker = `[${describeImages(images)} ${note}]`;
  return { ...rest, content: rest.content ? `${rest.content}\n${marker}` : marker };
}

/** A copy of the conversation without base64 image data (for saving to disk). */
export function stripImageData(messages: readonly Message[]): Message[] {
  return messages.map((m) => (m.role === 'user' && m.images?.length ? withoutImages(m, 'were attached (not saved with the session)') : m));
}
