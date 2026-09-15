/**
 * Minimal, lenient XML parser for Office Open XML parts. It keeps element
 * order (needed for mixed content), strips namespace prefixes from element and
 * attribute names, and never throws on malformed input: unclosed elements are
 * closed at end of input, stray end tags are ignored.
 */

export interface XmlElement {
    /** Local name without namespace prefix (e.g. `p` for `<w:p>`). */
    name: string;
    /** Attributes keyed by local name (e.g. `val` for `w:val`). */
    attrs: Record<string, string>;
    children: XmlNode[];
}

export type XmlNode = XmlElement | string;

const NAMED_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeXmlEntities(text: string): string {
    if (!text.includes('&')) {
        return text;
    }
    return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
        if (body[0] === '#') {
            const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
            return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
        }
        return NAMED_ENTITIES[body] ?? whole;
    });
}

function localName(qualified: string): string {
    const colon = qualified.indexOf(':');
    return colon === -1 ? qualified : qualified.slice(colon + 1);
}

const ATTR_RE = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

export function parseXml(src: string): XmlElement {
    const root: XmlElement = { name: '#document', attrs: {}, children: [] };
    const stack: XmlElement[] = [root];
    let pos = 0;
    const len = src.length;

    while (pos < len) {
        const lt = src.indexOf('<', pos);
        const textEnd = lt === -1 ? len : lt;
        if (textEnd > pos) {
            stack[stack.length - 1].children.push(decodeXmlEntities(src.slice(pos, textEnd)));
        }
        if (lt === -1) {
            break;
        }
        if (src.startsWith('<?', lt)) {
            pos = skipPast(src, '?>', lt + 2);
        } else if (src.startsWith('<!--', lt)) {
            pos = skipPast(src, '-->', lt + 4);
        } else if (src.startsWith('<![CDATA[', lt)) {
            const end = src.indexOf(']]>', lt + 9);
            const stop = end === -1 ? len : end;
            stack[stack.length - 1].children.push(src.slice(lt + 9, stop));
            pos = end === -1 ? len : end + 3;
        } else if (src.startsWith('<!', lt)) {
            pos = skipPast(src, '>', lt + 2);
        } else if (src[lt + 1] === '/') {
            const gt = src.indexOf('>', lt + 2);
            const name = localName(src.slice(lt + 2, gt === -1 ? len : gt).trim());
            for (let i = stack.length - 1; i > 0; i--) {
                if (stack[i].name === name) {
                    stack.length = i;
                    break;
                }
            }
            pos = gt === -1 ? len : gt + 1;
        } else {
            // Start tag: find the closing '>' while respecting quoted attribute values.
            let i = lt + 1;
            let quote = '';
            while (i < len) {
                const ch = src[i];
                if (quote) {
                    if (ch === quote) {
                        quote = '';
                    }
                } else if (ch === '"' || ch === "'") {
                    quote = ch;
                } else if (ch === '>') {
                    break;
                }
                i++;
            }
            let inner = src.slice(lt + 1, i);
            const selfClosing = inner.endsWith('/');
            if (selfClosing) {
                inner = inner.slice(0, -1);
            }
            const nameMatch = /^[^\s/>]+/.exec(inner);
            pos = i + 1;
            if (!nameMatch) {
                continue;
            }
            const el: XmlElement = { name: localName(nameMatch[0]), attrs: {}, children: [] };
            ATTR_RE.lastIndex = nameMatch[0].length;
            let m: RegExpExecArray | null;
            while ((m = ATTR_RE.exec(inner)) !== null) {
                const key = localName(m[1]);
                if (!(key in el.attrs)) {
                    el.attrs[key] = decodeXmlEntities(m[3] ?? m[4] ?? '');
                }
            }
            stack[stack.length - 1].children.push(el);
            if (!selfClosing) {
                stack.push(el);
            }
        }
    }
    return root;
}

function skipPast(src: string, marker: string, from: number): number {
    const idx = src.indexOf(marker, from);
    return idx === -1 ? src.length : idx + marker.length;
}

export function isElement(node: XmlNode): node is XmlElement {
    return typeof node !== 'string';
}

/** Direct child elements, optionally filtered by local name. */
export function childElements(el: XmlElement, name?: string): XmlElement[] {
    const out: XmlElement[] = [];
    for (const child of el.children) {
        if (isElement(child) && (name === undefined || child.name === name)) {
            out.push(child);
        }
    }
    return out;
}

export function firstChild(el: XmlElement, name: string): XmlElement | undefined {
    for (const child of el.children) {
        if (isElement(child) && child.name === name) {
            return child;
        }
    }
    return undefined;
}

/** First descendant (depth-first, document order) with the given local name. */
export function findFirst(el: XmlElement, name: string): XmlElement | undefined {
    for (const child of el.children) {
        if (isElement(child)) {
            if (child.name === name) {
                return child;
            }
            const found = findFirst(child, name);
            if (found) {
                return found;
            }
        }
    }
    return undefined;
}

/** All descendants with the given local name, in document order (does not descend into matches). */
export function findAll(el: XmlElement, name: string, out: XmlElement[] = []): XmlElement[] {
    for (const child of el.children) {
        if (isElement(child)) {
            if (child.name === name) {
                out.push(child);
            } else {
                findAll(child, name, out);
            }
        }
    }
    return out;
}
