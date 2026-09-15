/** Yields the `data:` payload of each server-sent event. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const boundary = /\r?\n\r?\n/;

  function* drain(final: boolean): Generator<string> {
    for (;;) {
      const m = boundary.exec(buffer);
      let raw: string;
      if (m) {
        raw = buffer.slice(0, m.index);
        buffer = buffer.slice(m.index + m[0].length);
      } else if (final && buffer.trim()) {
        raw = buffer;
        buffer = '';
      } else {
        return;
      }
      const data = raw
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''));
      if (data.length) yield data.join('\n');
    }
  }

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      yield* drain(false);
    }
    buffer += decoder.decode();
    yield* drain(true);
  } finally {
    reader.releaseLock();
  }
}

/**
 * An AbortSignal that fires when the caller aborts OR when no data has
 * arrived for `idleMs` (a hung provider must not hang the agent forever).
 */
export function idleSignal(parent: AbortSignal | undefined, idleMs: number, onIdle: () => Error) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) controller.abort(parent.reason);
  else parent?.addEventListener('abort', onAbort, { once: true });
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(onIdle()), idleMs);
  };
  touch();
  return {
    signal: controller.signal,
    touch,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}
