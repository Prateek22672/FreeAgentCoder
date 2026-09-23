/**
 * A streaming reader for the tar archives GitHub serves.
 *
 * It decides from each entry's header, before the data arrives, whether the
 * content is worth keeping, so a repository with a committed 2 GB dataset costs
 * nothing beyond the headers. Handles ustar prefixes, pax extended headers
 * (GitHub uses them for long paths) and GNU long names.
 */
import type { RawEntry } from '@agentic/project-brain';

const BLOCK = 512;
const decoder = new TextDecoder();

function readString(block: Uint8Array, offset: number, length: number): string {
    const slice = block.subarray(offset, offset + length);
    const end = slice.indexOf(0);
    return decoder.decode(end === -1 ? slice : slice.subarray(0, end));
}

function readOctal(block: Uint8Array, offset: number, length: number): number {
    const text = readString(block, offset, length).trim();
    return text ? parseInt(text, 8) : 0;
}

/** "path=foo/bar\n" records from a pax header. */
function paxPath(data: Uint8Array): string | undefined {
    const text = decoder.decode(data);
    let index = 0;
    while (index < text.length) {
        const space = text.indexOf(' ', index);
        if (space === -1) break;
        const length = parseInt(text.slice(index, space), 10);
        if (!length) break;
        const record = text.slice(space + 1, index + length - 1);
        if (record.startsWith('path=')) return record.slice(5);
        index += length;
    }
    return undefined;
}

export interface TarOptions {
    /** Called with each file's path and size; return true to keep its bytes. */
    keep: (path: string, size: number) => boolean;
    /** Strip the first path segment (GitHub's "owner-repo-sha/" folder). */
    stripFirst?: boolean;
    /** Abort once this many uncompressed bytes have been read. */
    maxBytes?: number;
}

export class TarTooLargeError extends Error {}

export async function readTar(stream: ReadableStream<Uint8Array>, options: TarOptions): Promise<RawEntry[]> {
    const entries: RawEntry[] = [];
    const reader = stream.getReader();
    let buffer = new Uint8Array(0);
    let total = 0;
    let done = false;

    const pull = async (): Promise<boolean> => {
        if (done) return false;
        const { value, done: finished } = await reader.read();
        if (finished) {
            done = true;
            return false;
        }
        total += value.length;
        if (options.maxBytes && total > options.maxBytes) {
            await reader.cancel();
            throw new TarTooLargeError(`Repository archive is larger than ${Math.round(options.maxBytes / 1_048_576)} MB.`);
        }
        const next = new Uint8Array(buffer.length + value.length);
        next.set(buffer);
        next.set(value, buffer.length);
        buffer = next;
        return true;
    };

    /** Make sure `n` bytes are buffered; false at end of stream. */
    const need = async (n: number): Promise<boolean> => {
        while (buffer.length < n) if (!(await pull())) return buffer.length >= n;
        return true;
    };

    const take = (n: number): Uint8Array => {
        const out = buffer.subarray(0, n);
        buffer = buffer.subarray(n);
        return out;
    };

    /** Skip `n` bytes without keeping them, pulling as needed. */
    const skip = async (n: number): Promise<void> => {
        let left = n;
        while (left > 0) {
            if (!buffer.length && !(await pull())) return;
            const step = Math.min(left, buffer.length);
            buffer = buffer.subarray(step);
            left -= step;
        }
    };

    let longName: string | undefined;
    while (await need(BLOCK)) {
        const header = take(BLOCK);
        if (header.every((b) => b === 0)) break; // end of archive

        const size = readOctal(header, 124, 12);
        const type = String.fromCharCode(header[156] ?? 0);
        const padded = Math.ceil(size / BLOCK) * BLOCK;

        if (type === 'x' || type === 'L') {
            // Metadata for the next entry.
            if (!(await need(padded))) break;
            const data = take(padded).slice(0, size);
            longName = type === 'x' ? paxPath(data) : readString(data, 0, size);
            continue;
        }
        if (type === 'g') {
            await skip(padded); // global pax header (GitHub puts the commit id here)
            continue;
        }

        const prefix = readString(header, 345, 155);
        const name = readString(header, 0, 100);
        let path = longName ?? (prefix ? `${prefix}/${name}` : name);
        longName = undefined;
        if (options.stripFirst) path = path.slice(path.indexOf('/') + 1);

        const isFile = type === '0' || type === '\0' || type === '';
        if (!isFile || !path || path.endsWith('/')) {
            await skip(padded);
            continue;
        }
        // Never let an archive name escape the repository root.
        if (path.startsWith('/') || path.split('/').includes('..')) {
            await skip(padded);
            continue;
        }

        if (options.keep(path, size)) {
            if (!(await need(padded))) break;
            entries.push({ path, size, bytes: take(padded).slice(0, size) });
        } else {
            await skip(padded);
            entries.push({ path, size });
        }
    }
    return entries;
}
