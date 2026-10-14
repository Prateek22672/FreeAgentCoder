/**
 * The old binary Office formats, read properly: a Compound File (CFB)
 * reader, then each format's own structure. .doc through Word's piece table,
 * .xls through its BIFF8 records (sheets, shared strings, numbers), .ppt
 * through its text atoms, and Outlook .msg through its property streams.
 * Specs: [MS-CFB], [MS-DOC], [MS-XLS], [MS-PPT], [MS-OXMSG].
 */

import { decodeCp1252 } from './text';

const END_OF_CHAIN = 0xfffffffe;
const utf16 = new TextDecoder('utf-16le');

interface DirEntry {
    name: string;
    type: number;
    start: number;
    size: number;
}

export class CompoundFile {
    private readonly view: DataView;
    private readonly sectorSize: number;
    private readonly miniSectorSize: number;
    private readonly miniCutoff: number;
    private readonly fat: number[] = [];
    private readonly miniFat: number[] = [];
    readonly entries: DirEntry[] = [];
    private miniStream?: Uint8Array;

    constructor(private readonly bytes: Uint8Array) {
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        this.sectorSize = 1 << this.view.getUint16(0x1e, true);
        this.miniSectorSize = 1 << this.view.getUint16(0x20, true);
        this.miniCutoff = this.view.getUint32(0x38, true);
        // The FAT's own sectors: 109 in the header, the rest in a DIFAT chain.
        const fatSectors: number[] = [];
        for (let i = 0; i < 109; i++) {
            const s = this.view.getUint32(0x4c + i * 4, true);
            if (s < END_OF_CHAIN - 1) {fatSectors.push(s);}
        }
        let difat = this.view.getUint32(0x44, true);
        for (let guard = 0; difat < END_OF_CHAIN - 1 && guard < 10_000; guard++) {
            const base = this.offset(difat);
            const per = this.sectorSize / 4 - 1;
            for (let i = 0; i < per; i++) {
                const s = this.view.getUint32(base + i * 4, true);
                if (s < END_OF_CHAIN - 1) {fatSectors.push(s);}
            }
            difat = this.view.getUint32(base + per * 4, true);
        }
        for (const s of fatSectors) {
            const base = this.offset(s);
            for (let i = 0; i < this.sectorSize / 4 && base + i * 4 + 4 <= bytes.length; i++) {this.fat.push(this.view.getUint32(base + i * 4, true));}
        }
        const miniFatStart = this.view.getUint32(0x3c, true);
        if (miniFatStart < END_OF_CHAIN - 1) {
            const data = this.readChain(miniFatStart);
            const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
            for (let i = 0; i + 4 <= data.length; i += 4) {this.miniFat.push(v.getUint32(i, true));}
        }
        const dir = this.readChain(this.view.getUint32(0x30, true));
        const dv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
        for (let i = 0; i + 128 <= dir.length; i += 128) {
            const nameLength = dv.getUint16(i + 64, true);
            this.entries.push({
                name: utf16.decode(dir.subarray(i, i + Math.max(0, nameLength - 2))),
                type: dir[i + 66]!,
                start: dv.getUint32(i + 116, true),
                size: dv.getUint32(i + 120, true),
            });
        }
    }

    private offset(sector: number): number {
        return (sector + 1) * this.sectorSize;
    }

    private readChain(start: number, limit = Infinity): Uint8Array {
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (let s = start, guard = 0; s < END_OF_CHAIN - 1 && guard < 1_000_000 && total < limit; guard++) {
            const at = this.offset(s);
            if (at >= this.bytes.length) {break;}
            const chunk = this.bytes.subarray(at, Math.min(at + this.sectorSize, this.bytes.length));
            chunks.push(chunk);
            total += chunk.length;
            s = this.fat[s] ?? END_OF_CHAIN;
        }
        return concat(chunks, Math.min(total, limit));
    }

    /** A stream's bytes by name (case-insensitive), or undefined. */
    stream(name: string): Uint8Array | undefined {
        const entry = this.entries.find((e) => e.type === 2 && e.name.toLowerCase() === name.toLowerCase());
        if (!entry) {return undefined;}
        if (entry.size >= this.miniCutoff) {return this.readChain(entry.start, entry.size);}
        const root = this.entries.find((e) => e.type === 5);
        this.miniStream ??= root ? this.readChain(root.start, root.size) : new Uint8Array();
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (let s = entry.start, guard = 0; s < END_OF_CHAIN - 1 && guard < 1_000_000 && total < entry.size; guard++) {
            const at = s * this.miniSectorSize;
            chunks.push(this.miniStream.subarray(at, at + this.miniSectorSize));
            total += this.miniSectorSize;
            s = this.miniFat[s] ?? END_OF_CHAIN;
        }
        return concat(chunks, entry.size);
    }

    has(name: string): boolean {
        return this.entries.some((e) => e.name.toLowerCase() === name.toLowerCase());
    }
}

function concat(chunks: Uint8Array[], length: number): Uint8Array {
    const out = new Uint8Array(length);
    let at = 0;
    for (const c of chunks) {
        if (at >= length) {break;}
        out.set(c.subarray(0, length - at), at);
        at += c.length;
    }
    return out;
}

// ---------------------------------------------------------------- Word .doc

/** The document text from Word's piece table, with fields, cell marks and control characters turned into plain text. */
export function docText(cfb: CompoundFile): string | undefined {
    const word = cfb.stream('WordDocument');
    if (!word || word.length < 0x1aa) {return undefined;}
    const v = new DataView(word.buffer, word.byteOffset, word.byteLength);
    if (v.getUint16(0, true) !== 0xa5ec) {return undefined;}
    const flags = v.getUint16(0x0a, true);
    if (flags & 0x0100) {throw new Error('This Word document is password-protected (encrypted). Remove the password and attach it again.');}
    const table = cfb.stream(flags & 0x0200 ? '1Table' : '0Table');
    if (!table) {return undefined;}
    // FibRgFcLcb97 follows the fixed part, csw and cslw blocks: fcClx is its 34th pair.
    const csw = v.getUint16(32, true);
    const lwStart = 34 + csw * 2;
    const cslw = v.getUint16(lwStart, true);
    const blob = lwStart + 2 + cslw * 4 + 2;
    const fcClx = v.getUint32(blob + 33 * 8, true);
    const lcbClx = v.getUint32(blob + 33 * 8 + 4, true);
    const tv = new DataView(table.buffer, table.byteOffset, table.byteLength);
    let at = fcClx;
    const end = Math.min(table.length, fcClx + lcbClx);
    // Skip any Prc blocks (formatting), then read the Pcdt.
    while (at < end && table[at] === 0x01) {at += 3 + tv.getInt16(at + 1, true);}
    if (table[at] !== 0x02) {return undefined;}
    const lcb = tv.getUint32(at + 1, true);
    const plc = at + 5;
    const pieces = Math.floor((lcb - 4) / 12);
    let text = '';
    for (let i = 0; i < pieces; i++) {
        const cpStart = tv.getUint32(plc + i * 4, true);
        const cpEnd = tv.getUint32(plc + (i + 1) * 4, true);
        const pcd = plc + (pieces + 1) * 4 + i * 8;
        const fc = tv.getUint32(pcd + 2, true);
        const chars = cpEnd - cpStart;
        if (chars <= 0 || chars > 50_000_000) {continue;}
        if (fc & 0x40000000) {
            const from = (fc & 0x3fffffff) / 2;
            text += decodeCp1252(word.subarray(from, from + chars));
        } else {
            text += utf16.decode(word.subarray(fc, fc + chars * 2));
        }
    }
    return cleanWordText(text);
}

export function cleanWordText(text: string): string {
    // Field codes: \x13 code \x14 result \x15 -> the result; a field with no result keeps nothing.
    let out = '';
    let depth = 0;
    let showing: boolean[] = [];
    for (const ch of text) {
        if (ch === '\x13') {
            depth++;
            showing.push(false);
        } else if (ch === '\x14' && depth) {
            showing[showing.length - 1] = true;
        } else if (ch === '\x15' && depth) {
            depth--;
            showing.pop();
        } else if (!depth || showing.every(Boolean)) {
            out += ch;
        }
    }
    showing = [];
    return out
        .replace(/\x07\r?\x07/g, '\n')
        .replace(/\x07/g, ' | ')
        .replace(/[\r\x0b]/g, '\n')
        .replace(/\x0c/g, '\n\n')
        .replace(/\x1e/g, '-')
        .replace(/[\x00-\x08\x0e-\x1f]/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// ---------------------------------------------------------------- Excel .xls (BIFF8)

/** The sheets as CSV: shared strings, labels, numbers (including RK and MULRK) and cached formula numbers. */
export function xlsText(cfb: CompoundFile, maxRows = 2000): string | undefined {
    const book = cfb.stream('Workbook') ?? cfb.stream('Book');
    if (!book) {return undefined;}
    const v = new DataView(book.buffer, book.byteOffset, book.byteLength);
    const records: { type: number; data: Uint8Array }[] = [];
    for (let at = 0; at + 4 <= book.length; ) {
        const type = v.getUint16(at, true);
        const len = v.getUint16(at + 2, true);
        records.push({ type, data: book.subarray(at + 4, at + 4 + len) });
        at += 4 + len;
    }
    if (records.some((r) => r.type === 0x002f)) {throw new Error('This Excel workbook is password-protected (encrypted). Remove the password and attach it again.');}
    const strings = readSst(records);
    // Which cell formats are dates: built-in date formats, and custom ones made of d, m, y, h or s.
    const customFormats = new Map<number, string>();
    for (const r of records.filter((x) => x.type === 0x041e)) {
        const d = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
        const cch = d.getUint16(2, true);
        const high = r.data[4]! & 1;
        customFormats.set(d.getUint16(0, true), high ? utf16.decode(r.data.subarray(5, 5 + cch * 2)) : decodeCp1252(r.data.subarray(5, 5 + cch)));
    }
    const dateXfs = new Set<number>();
    records
        .filter((x) => x.type === 0x00e0)
        .forEach((r, index) => {
            const ifmt = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength).getUint16(2, true);
            const code = customFormats.get(ifmt)?.replace(/"[^"]*"|\[[^\]]*\]|\./g, '');
            if ((ifmt >= 14 && ifmt <= 22) || (ifmt >= 45 && ifmt <= 47) || (code && /[dmyhs]/i.test(code) && !/^general$/i.test(code))) {dateXfs.add(index);}
        });
    const value = (n: number, xf: number) => (dateXfs.has(xf) && n > 0 && n < 2958466 ? serialDate(n) : formatNumber(n));
    const sheetNames = records.filter((r) => r.type === 0x0085).map((r) => {
        const cch = r.data[6]!;
        const high = r.data[7]! & 1;
        return high ? utf16.decode(r.data.subarray(8, 8 + cch * 2)) : decodeCp1252(r.data.subarray(8, 8 + cch));
    });
    const sheets: Map<number, string>[][] = [];
    let current: Map<number, string>[] | undefined;
    let inSheet = false;
    for (const r of records) {
        const d = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
        const set = (row: number, col: number, value: string) => {
            if (!current || row >= maxRows || col > 255) {return;}
            (current[row] ??= new Map()).set(col, value);
        };
        switch (r.type) {
            case 0x0809: // BOF
                inSheet = d.getUint16(2, true) === 0x0010;
                if (inSheet) {sheets.push((current = []));}
                break;
            case 0x000a: // EOF
                inSheet = false;
                current = undefined;
                break;
            case 0x00fd: // LABELSST
                if (inSheet) {set(d.getUint16(0, true), d.getUint16(2, true), strings[d.getUint32(6, true)] ?? '');}
                break;
            case 0x0203: // NUMBER
                if (inSheet) {set(d.getUint16(0, true), d.getUint16(2, true), value(d.getFloat64(6, true), d.getUint16(4, true)));}
                break;
            case 0x027e: // RK
                if (inSheet) {set(d.getUint16(0, true), d.getUint16(2, true), value(rk(d.getUint32(6, true)), d.getUint16(4, true)));}
                break;
            case 0x00bd: {
                // MULRK
                if (!inSheet) {break;}
                const row = d.getUint16(0, true);
                const first = d.getUint16(2, true);
                const count = (r.data.length - 6) / 6;
                for (let i = 0; i < count; i++) {set(row, first + i, value(rk(d.getUint32(4 + i * 6 + 2, true)), d.getUint16(4 + i * 6, true)));}
                break;
            }
            case 0x0006: // FORMULA: a cached number unless the top bytes say string, bool or error
                if (inSheet && !(d.getUint16(12, true) === 0xffff)) {set(d.getUint16(0, true), d.getUint16(2, true), value(d.getFloat64(6, true), d.getUint16(4, true)));}
                break;
            case 0x0204: {
                // LABEL (older files)
                if (!inSheet) {break;}
                const cch = d.getUint16(6, true);
                const high = r.data[8]! & 1;
                set(d.getUint16(0, true), d.getUint16(2, true), high ? utf16.decode(r.data.subarray(9, 9 + cch * 2)) : decodeCp1252(r.data.subarray(9, 9 + cch)));
                break;
            }
        }
    }
    const csv = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
    return sheets
        .map((rows, i) => {
            const lines = rows
                .map((row) => {
                    if (!row) {return '';}
                    const width = Math.max(...row.keys()) + 1;
                    return Array.from({ length: width }, (_, c) => csv(row.get(c) ?? '')).join(',');
                })
                .filter((line) => line.replace(/,/g, '').trim());
            return `--- Sheet: ${sheetNames[i] ?? `Sheet ${i + 1}`} ---\n${lines.join('\n')}`.trimEnd();
        })
        .join('\n\n');
}

function rk(value: number): number {
    const div = value & 1;
    const isInt = value & 2;
    let n: number;
    if (isInt) {
        n = value >> 2;
    } else {
        const buf = new DataView(new ArrayBuffer(8));
        buf.setUint32(4, value & 0xfffffffc, true);
        n = buf.getFloat64(0, true);
    }
    return div ? n / 100 : n;
}

/** Excel's day number as a date (1900 system), with the time when there is one. */
function serialDate(serial: number): string {
    const iso = new Date(Math.round((serial - 25569) * 86400000)).toISOString();
    return serial % 1 === 0 ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
}

function formatNumber(n: number): string {
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 1e10) / 1e10);
}

/** The shared string table, across its CONTINUE records (a string may break between them). */
function readSst(records: { type: number; data: Uint8Array }[]): string[] {
    const index = records.findIndex((r) => r.type === 0x00fc);
    if (index < 0) {return [];}
    const chunks = [records[index]!.data];
    for (let i = index + 1; i < records.length && records[i]!.type === 0x003c; i++) {chunks.push(records[i]!.data);}
    let chunk = 0;
    let at = 8;
    const byte = () => {
        while (chunk < chunks.length && at >= chunks[chunk]!.length) {
            chunk++;
            at = 0;
        }
        return chunks[chunk]?.[at++] ?? 0;
    };
    const u16 = () => byte() | (byte() << 8);
    const u32 = () => (byte() | (byte() << 8) | (byte() << 16) | (byte() << 24)) >>> 0;
    const skip = (n: number) => {
        for (let i = 0; i < n; i++) {byte();}
    };
    const total = new DataView(chunks[0]!.buffer, chunks[0]!.byteOffset, chunks[0]!.byteLength).getUint32(4, true);
    const out: string[] = [];
    for (let s = 0; s < Math.min(total, 500_000) && chunk < chunks.length; s++) {
        const cch = u16();
        const flags = byte();
        let high = flags & 1;
        const runs = flags & 8 ? u16() : 0;
        const ext = flags & 4 ? u32() : 0;
        let text = '';
        for (let i = 0; i < cch; i++) {
            // At a CONTINUE boundary inside the characters, a new flags byte says how the rest is stored.
            if (chunk < chunks.length && at >= chunks[chunk]!.length) {
                chunk++;
                at = 0;
                high = (chunks[chunk]?.[at++] ?? 0) & 1;
            }
            text += high ? String.fromCharCode(u16()) : decodeCp1252([byte()]);
        }
        skip(runs * 4 + ext);
        out.push(text);
    }
    return out;
}

// ---------------------------------------------------------------- PowerPoint .ppt

/**
 * Slide text: each Slide container's text atoms, in order. Masters, notes
 * pages and handouts are skipped (their "Click to edit…" text is template,
 * not content). Older files that keep the text in the document's slide list
 * are read from there when no slide holds any.
 */
export function pptText(cfb: CompoundFile): string | undefined {
    const doc = cfb.stream('PowerPoint Document');
    if (!doc) {return undefined;}
    const v = new DataView(doc.buffer, doc.byteOffset, doc.byteLength);
    const SLIDE = 0x03ee;
    const SKIP = new Set([0x03f8, 0x03f0, 0x0fc9]); // masters, notes pages, handout
    const slides: string[][] = [];
    const listed: string[][] = [[]];
    const atom = (type: number, body: number, len: number) =>
        type === 0x0fa0 ? utf16.decode(doc.subarray(body, body + len)) : type === 0x0fa8 ? decodeCp1252(doc.subarray(body, body + len)) : undefined;
    const walk = (start: number, end: number, depth: number, slide: string[] | undefined, inList: boolean) => {
        for (let at = start; at + 8 <= end && depth < 30; ) {
            const verInst = v.getUint16(at, true);
            const type = v.getUint16(at + 2, true);
            const len = v.getUint32(at + 4, true);
            const body = at + 8;
            if (body + len > end) {break;}
            if ((verInst & 0x0f) === 0x0f) {
                if (type === SLIDE) {
                    const own: string[] = [];
                    slides.push(own);
                    walk(body, body + len, depth + 1, own, false);
                } else if (!SKIP.has(type)) {
                    walk(body, body + len, depth + 1, slide, inList || type === 0x0ff0);
                }
            } else if (type === 0x03f3 && inList) {
                if (listed[listed.length - 1]!.length) {listed.push([]);}
            } else {
                const text = atom(type, body, len);
                if (text !== undefined) {(slide ?? (inList ? listed[listed.length - 1] : undefined))?.push(text);}
            }
            at = body + len;
        }
    };
    walk(0, doc.length, 0, undefined, false);
    const clean = (groups: string[][]) => groups.map((lines) => lines.map((l) => l.replace(/\r/g, '\n').trim()).filter((l) => l && l !== '*')).filter((lines) => lines.length);
    const shown = clean(slides).length ? clean(slides) : clean(listed);
    return shown.map((lines, i) => `--- Slide ${i + 1} ---\n# ${lines[0]}${lines.length > 1 ? `\n\n${lines.slice(1).join('\n')}` : ''}`).join('\n\n');
}

// ---------------------------------------------------------------- Outlook .msg

export function msgText(cfb: CompoundFile): string | undefined {
    const prop = (id: string): string => {
        const unicode = cfb.stream(`__substg1.0_${id}001F`);
        if (unicode) {return utf16.decode(unicode).replace(/\0+$/, '');}
        const ascii = cfb.stream(`__substg1.0_${id}001E`);
        return ascii ? decodeCp1252(ascii).replace(/\0+$/, '') : '';
    };
    const subject = prop('0037');
    const body = prop('1000');
    if (!subject && !body) {return undefined;}
    const lines = [
        prop('0C1A') && `From: ${prop('0C1A')}${prop('0C1F') ? ` <${prop('0C1F')}>` : ''}`,
        prop('0E04') && `To: ${prop('0E04')}`,
        prop('0E03') && `Cc: ${prop('0E03')}`,
        subject && `Subject: ${subject}`,
    ].filter(Boolean);
    const attachments = cfb.entries.filter((e) => e.type === 1 && /^__attach_version1\.0_/i.test(e.name)).length;
    return [lines.join('\n'), body.replace(/\r\n?/g, '\n').trim(), attachments ? `Attachments: ${attachments}` : ''].filter(Boolean).join('\n\n');
}

/** The text of an old Office file by its structure, or undefined when it is none of the known kinds. */
export function legacyOfficeText(bytes: Uint8Array): { format: string; text: string } | undefined {
    const cfb = new CompoundFile(bytes);
    if (cfb.has('WordDocument')) {
        const text = docText(cfb);
        return text === undefined ? undefined : { format: 'doc', text };
    }
    if (cfb.has('Workbook') || cfb.has('Book')) {
        const text = xlsText(cfb);
        return text === undefined ? undefined : { format: 'xls', text };
    }
    if (cfb.has('PowerPoint Document')) {
        const text = pptText(cfb);
        return text === undefined ? undefined : { format: 'ppt', text };
    }
    if (cfb.entries.some((e) => /^__substg1\.0_/i.test(e.name))) {
        const text = msgText(cfb);
        return text === undefined ? undefined : { format: 'msg', text };
    }
    return undefined;
}
