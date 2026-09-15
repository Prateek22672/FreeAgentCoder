/** Text decoding, binary detection, and HTML / RTF to plain text. */

function swapBytes(bytes: Uint8Array): Uint8Array {
    const out = new Uint8Array(bytes.length - (bytes.length % 2));
    for (let i = 0; i + 1 < bytes.length; i += 2) {
        out[i] = bytes[i + 1];
        out[i + 1] = bytes[i];
    }
    return out;
}

function decodeUtf16(bytes: Uint8Array, bigEndian: boolean): string {
    const le = bigEndian ? swapBytes(bytes) : bytes;
    return new TextDecoder('utf-16le').decode(le);
}

/** Windows-1252 bytes 0x80-0x9F (Node's TextDecoder treats this label as ISO-8859-1). */
const CP1252_HIGH = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

export function decodeCp1252(bytes: Uint8Array | number[]): string {
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        out += b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b);
    }
    return out;
}

/** Share of C0 control characters other than tab/newline/carriage return/form feed/escape. */
function controlRatio(text: string): number {
    const sample = text.length > 8192 ? text.slice(0, 8192) : text;
    if (!sample.length) {
        return 0;
    }
    let bad = 0;
    for (let i = 0; i < sample.length; i++) {
        const c = sample.charCodeAt(i);
        if ((c < 32 && c !== 9 && c !== 10 && c !== 13 && c !== 12 && c !== 27) || c === 0xfffd) {
            bad++;
        }
    }
    return bad / sample.length;
}

/** Guess UTF-16 without BOM from the distribution of zero bytes (mostly-ASCII text). */
function sniffUtf16(bytes: Uint8Array): 'le' | 'be' | undefined {
    const n = Math.min(bytes.length, 4096) & ~1;
    if (n < 4) {
        return undefined;
    }
    let evenZeros = 0;
    let oddZeros = 0;
    for (let i = 0; i < n; i += 2) {
        if (bytes[i] === 0) {
            evenZeros++;
        }
        if (bytes[i + 1] === 0) {
            oddZeros++;
        }
    }
    const half = n / 2;
    if (oddZeros > half * 0.4 && evenZeros < half * 0.05) {
        return 'le';
    }
    if (evenZeros > half * 0.4 && oddZeros < half * 0.05) {
        return 'be';
    }
    return undefined;
}

/**
 * Decode bytes as text (UTF-8, UTF-16 LE/BE with or without BOM, Windows-1252
 * fallback). Returns `undefined` when the content looks binary.
 */
export function decodeText(bytes: Uint8Array): { text: string; encoding: string } | undefined {
    let text: string;
    let encoding: string;
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        text = new TextDecoder('utf-8').decode(bytes.subarray(3));
        encoding = 'utf-8';
    } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
        text = decodeUtf16(bytes.subarray(2), false);
        encoding = 'utf-16le';
    } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
        text = decodeUtf16(bytes.subarray(2), true);
        encoding = 'utf-16be';
    } else {
        const utf16 = sniffUtf16(bytes);
        if (utf16) {
            text = decodeUtf16(bytes, utf16 === 'be');
            encoding = `utf-16${utf16}`;
        } else {
            const head = bytes.subarray(0, 8192);
            if (head.includes(0)) {
                return undefined;
            }
            try {
                text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
                encoding = 'utf-8';
            } catch {
                // A multi-byte sequence may be cut at the very end; otherwise treat as a legacy code page.
                try {
                    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, Math.max(0, bytes.length - 3)));
                    text = new TextDecoder('utf-8').decode(bytes);
                    encoding = 'utf-8';
                } catch {
                    text = decodeCp1252(bytes);
                    encoding = 'windows-1252';
                }
            }
        }
    }
    if (controlRatio(text) > 0.05) {
        return undefined;
    }
    return { text, encoding };
}

const HTML_ENTITIES: Record<string, string> = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", copy: '©', reg: '®', trade: '™',
    hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•',
    middot: '·', euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', deg: '°', plusmn: '±',
    times: '×', divide: '÷', laquo: '«', raquo: '»', shy: '', ensp: ' ', emsp: ' ', thinsp: ' ',
    zwj: '', zwnj: '', larr: '←', rarr: '→', uarr: '↑', darr: '↓', check: '✓',
};

export function decodeHtmlEntities(text: string): string {
    return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);?/g, (whole, body: string) => {
        if (body[0] === '#') {
            const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
            return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
        }
        const value = HTML_ENTITIES[body] ?? HTML_ENTITIES[body.toLowerCase()];
        return value ?? whole;
    });
}

/** Collapse runs of spaces, trim line ends and limit blank lines to one. */
export function tidyWhitespace(text: string): string {
    return text
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t\f\v ]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

const BLOCK_TAGS = 'address|article|aside|blockquote|body|caption|dd|details|dialog|div|dl|dt|fieldset|figcaption|figure|footer|form|header|hr|html|main|nav|ol|p|pre|section|summary|table|tbody|thead|tfoot|ul';

export function htmlToText(html: string): string {
    let s = html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(script|style|noscript|template|svg|iframe|object|head)\b[\s\S]*?<\/\1\s*>/gi, (m, tag: string) => {
            // Keep the document title from <head>.
            if (tag.toLowerCase() !== 'head') {
                return '';
            }
            const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(m);
            return title ? `\n# ${title[1]}\n` : '';
        })
        .replace(/<(script|style|noscript|template)\b[^>]*\/>/gi, '');

    // Preserve whitespace inside <pre> by protecting newlines/spaces from tidyWhitespace.
    s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi, (_m, body: string) =>
        '\n' + body.replace(/<[^>]+>/g, '').replace(/\n/g, '').replace(/ /g, '') + '\n');

    s = s
        .replace(/<br\b[^>]*>/gi, '\n')
        .replace(/<h([1-6])\b[^>]*>/gi, (_m, level: string) => `\n\n${'#'.repeat(Number(level))} `)
        .replace(/<\/h[1-6]\s*>/gi, '\n\n')
        .replace(/<li\b[^>]*>/gi, '\n- ')
        .replace(/<tr\b[^>]*>/gi, '\n|')
        .replace(/<\/t[dh]\s*>/gi, ' |')
        .replace(/<t[dh]\b[^>]*>/gi, ' ')
        .replace(new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi'), '\n')
        .replace(/<img\b[^>]*\balt\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi, (_m, _q, a?: string, b?: string) => {
            const alt = (a ?? b ?? '').trim();
            return alt ? `[image: ${alt}]` : '';
        })
        .replace(/<[^>]*>/g, '');

    s = tidyWhitespace(decodeHtmlEntities(s).replace(/ /g, ' '));
    return s.replace(//g, '\n').replace(//g, ' ');
}

const RTF_SKIP_DESTINATIONS = new Set([
    'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'headerl', 'headerr', 'headerf',
    'footer', 'footerl', 'footerr', 'footerf', 'listtable', 'listoverridetable', 'rsidtbl', 'generator',
    'themedata', 'colorschememapping', 'datastore', 'latentstyles', 'xmlnstbl', 'mmathPr', 'fldinst',
    'filetbl', 'revtbl', 'pgdsctbl', 'bkmkstart', 'bkmkend', 'xe', 'tc', 'private', 'nonshppict', 'blipuid',
]);

const RTF_WORD_TEXT: Record<string, string> = {
    par: '\n', line: '\n', sect: '\n\n', page: '\n\n', row: '\n', cell: ' | ', tab: '\t',
    emdash: '—', endash: '–', emspace: ' ', enspace: ' ', qmspace: ' ', bullet: '•',
    lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”',
};

/** Strip RTF control words and groups, keeping readable text. Assumes Windows-1252 for `\'hh` escapes. */
export function rtfToText(rtf: string): string {
    let out = '';
    let pendingBytes: number[] = [];
    const flushBytes = () => {
        if (pendingBytes.length) {
            out += decodeCp1252(pendingBytes);
            pendingBytes = [];
        }
    };
    interface GroupState { skip: boolean; uc: number }
    const stack: GroupState[] = [];
    let state: GroupState = { skip: false, uc: 1 };
    let skipChars = 0; // fallback characters to skip after \uN
    let i = 0;
    const n = rtf.length;

    const emit = (text: string) => {
        if (skipChars > 0) {
            skipChars--;
            return;
        }
        if (!state.skip) {
            flushBytes();
            out += text;
        }
    };

    while (i < n) {
        const ch = rtf[i];
        if (ch === '{') {
            stack.push(state);
            state = { ...state };
            skipChars = 0;
            i++;
        } else if (ch === '}') {
            state = stack.pop() ?? { skip: false, uc: 1 };
            skipChars = 0;
            i++;
        } else if (ch === '\\') {
            const next = rtf[i + 1];
            if (next === undefined) {
                break;
            }
            if (next === '\\' || next === '{' || next === '}') {
                emit(next);
                i += 2;
            } else if (next === '\'') {
                const byte = parseInt(rtf.slice(i + 2, i + 4), 16);
                i += 4;
                if (skipChars > 0) {
                    skipChars--;
                } else if (!state.skip && Number.isFinite(byte)) {
                    pendingBytes.push(byte);
                }
            } else if (next === '*') {
                state.skip = true;
                i += 2;
            } else if (next === '~') {
                emit(' ');
                i += 2;
            } else if (next === '_') {
                emit('-');
                i += 2;
            } else if (next === '-') {
                i += 2;
            } else if (next === '\n' || next === '\r') {
                emit('\n');
                i += 2;
            } else if (/[a-zA-Z]/.test(next)) {
                const m = /^([a-zA-Z]{1,32})(-?\d{1,10})? ?/.exec(rtf.slice(i + 1, i + 48));
                if (!m) {
                    i += 2;
                    continue;
                }
                i += 1 + m[0].length;
                const word = m[1];
                const param = m[2] === undefined ? undefined : Number(m[2]);
                if (word === 'bin' && param !== undefined) {
                    i += Math.max(0, param);
                } else if (word === 'uc' && param !== undefined) {
                    state.uc = param;
                } else if (word === 'u' && param !== undefined) {
                    if (!state.skip) {
                        flushBytes();
                        const code = param < 0 ? param + 65536 : param;
                        out += String.fromCharCode(code);
                    }
                    skipChars = state.uc;
                } else if (RTF_SKIP_DESTINATIONS.has(word)) {
                    state.skip = true;
                } else if (word in RTF_WORD_TEXT) {
                    emit(RTF_WORD_TEXT[word]);
                }
            } else {
                i += 2;
            }
        } else if (ch === '\r' || ch === '\n') {
            i++;
        } else {
            emit(ch);
            i++;
        }
    }
    flushBytes();
    return out
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
