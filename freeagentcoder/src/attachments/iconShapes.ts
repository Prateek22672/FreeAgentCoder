import { ICONS } from './icons';

/**
 * Lucide icons as native PowerPoint shapes (custom geometry): sharp at any
 * size, recolourable in PowerPoint, and drawn the same by every viewer. An SVG
 * picture would need a PNG fallback that cannot be made outside a browser, so
 * LibreOffice and older PowerPoint would show a broken image.
 */

export type GeomPoint =
    | { x: number; y: number; moveTo?: boolean }
    | { x: number; y: number; curve: { type: 'cubic'; x1: number; y1: number; x2: number; y2: number } }
    | { close: true };

const KAPPA = 0.5522847498;

class Pen {
    readonly out: GeomPoint[] = [];
    x = 0;
    y = 0;
    private startX = 0;
    private startY = 0;

    move(x: number, y: number): void {
        this.out.push({ x, y, moveTo: true });
        this.x = this.startX = x;
        this.y = this.startY = y;
    }
    line(x: number, y: number): void {
        this.out.push({ x, y });
        this.x = x;
        this.y = y;
    }
    cubic(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
        this.out.push({ x, y, curve: { type: 'cubic', x1, y1, x2, y2 } });
        this.x = x;
        this.y = y;
    }
    close(): void {
        this.out.push({ close: true });
        this.x = this.startX;
        this.y = this.startY;
    }
    ellipse(cx: number, cy: number, rx: number, ry: number): void {
        const ox = rx * KAPPA;
        const oy = ry * KAPPA;
        this.move(cx + rx, cy);
        this.cubic(cx + rx, cy + oy, cx + ox, cy + ry, cx, cy + ry);
        this.cubic(cx - ox, cy + ry, cx - rx, cy + oy, cx - rx, cy);
        this.cubic(cx - rx, cy - oy, cx - ox, cy - ry, cx, cy - ry);
        this.cubic(cx + ox, cy - ry, cx + rx, cy - oy, cx + rx, cy);
        this.close();
    }

    /** SVG arc (endpoint form) as cubic curves, per the SVG 1.1 implementation notes. */
    arc(rx: number, ry: number, rotation: number, large: boolean, sweep: boolean, x: number, y: number): void {
        const x0 = this.x;
        const y0 = this.y;
        if (rx === 0 || ry === 0 || (x0 === x && y0 === y)) {
            this.line(x, y);
            return;
        }
        rx = Math.abs(rx);
        ry = Math.abs(ry);
        const phi = (rotation * Math.PI) / 180;
        const cos = Math.cos(phi);
        const sin = Math.sin(phi);
        const dx = (x0 - x) / 2;
        const dy = (y0 - y) / 2;
        const x1p = cos * dx + sin * dy;
        const y1p = -sin * dx + cos * dy;
        const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
        if (lambda > 1) {
            rx *= Math.sqrt(lambda);
            ry *= Math.sqrt(lambda);
        }
        const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
        const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
        const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
        const cxp = (coef * rx * y1p) / ry;
        const cyp = (-coef * ry * x1p) / rx;
        const cx = cos * cxp - sin * cyp + (x0 + x) / 2;
        const cy = sin * cxp + cos * cyp + (y0 + y) / 2;
        const angle = (ux: number, uy: number, vx: number, vy: number) => {
            const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
            return a;
        };
        const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
        let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
        if (!sweep && delta > 0) {delta -= 2 * Math.PI;}
        if (sweep && delta < 0) {delta += 2 * Math.PI;}
        const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
        const step = delta / segments;
        const t = (4 / 3) * Math.tan(step / 4);
        let a1 = theta1;
        for (let i = 0; i < segments; i++) {
            const a2 = a1 + step;
            const c1 = Math.cos(a1);
            const s1 = Math.sin(a1);
            const c2 = Math.cos(a2);
            const s2 = Math.sin(a2);
            const p = (ex: number, ey: number) => ({ x: cos * rx * ex - sin * ry * ey + cx, y: sin * rx * ex + cos * ry * ey + cy });
            const q1 = p(c1 - t * s1, s1 + t * c1);
            const q2 = p(c2 + t * s2, s2 - t * c2);
            const end = i === segments - 1 ? { x, y } : p(c2, s2);
            this.cubic(q1.x, q1.y, q2.x, q2.y, end.x, end.y);
            a1 = a2;
        }
    }
}

/** Splits path data into commands with their numbers; arc flags may be written without spaces ("a1 1 0 01.5.5"). */
function pathCommands(d: string): { cmd: string; args: number[] }[] {
    const out: { cmd: string; args: number[] }[] = [];
    let i = 0;
    let current: { cmd: string; args: number[] } | undefined;
    const number = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;
    while (i < d.length) {
        const ch = d[i]!;
        if (/[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) {
            current = { cmd: ch, args: [] };
            out.push(current);
            i++;
            continue;
        }
        if (/[\s,]/.test(ch)) {
            i++;
            continue;
        }
        if (!current) {break;}
        // The fourth and fifth numbers of each arc are flags: one digit each.
        const inArc = current.cmd === 'a' || current.cmd === 'A';
        const pos = current.args.length % 7;
        if (inArc && (pos === 3 || pos === 4) && (ch === '0' || ch === '1')) {
            current.args.push(Number(ch));
            i++;
            continue;
        }
        const m = number.exec(d.slice(i));
        if (!m) {
            i++;
            continue;
        }
        current.args.push(Number(m[0]));
        i += m[0].length;
    }
    return out;
}

function drawPath(pen: Pen, d: string): void {
    // Every <path> starts at 0,0: its first "m" is relative to that, not to where the previous element ended.
    pen.x = 0;
    pen.y = 0;
    let lastControl: { x: number; y: number; kind: 'c' | 'q' } | undefined;
    for (const { cmd, args } of pathCommands(d)) {
        const rel = cmd === cmd.toLowerCase();
        const C = cmd.toUpperCase();
        const take = (n: number) => {
            const groups: number[][] = [];
            for (let k = 0; k + n <= args.length; k += n) {groups.push(args.slice(k, k + n));}
            return n === 0 ? [[]] : groups;
        };
        switch (C) {
            case 'M':
                take(2).forEach(([x, y], k) => {
                    const px = rel ? pen.x + x! : x!;
                    const py = rel ? pen.y + y! : y!;
                    if (k === 0) {pen.move(px, py);}
                    else {pen.line(px, py);}
                });
                lastControl = undefined;
                break;
            case 'L':
                take(2).forEach(([x, y]) => pen.line(rel ? pen.x + x! : x!, rel ? pen.y + y! : y!));
                lastControl = undefined;
                break;
            case 'H':
                take(1).forEach(([x]) => pen.line(rel ? pen.x + x! : x!, pen.y));
                lastControl = undefined;
                break;
            case 'V':
                take(1).forEach(([y]) => pen.line(pen.x, rel ? pen.y + y! : y!));
                lastControl = undefined;
                break;
            case 'C':
                take(6).forEach(([a, b, c, e, x, y]) => {
                    const ox = rel ? pen.x : 0;
                    const oy = rel ? pen.y : 0;
                    pen.cubic(ox + a!, oy + b!, ox + c!, oy + e!, ox + x!, oy + y!);
                    lastControl = { x: ox + c!, y: oy + e!, kind: 'c' };
                });
                break;
            case 'S':
                take(4).forEach(([c, e, x, y]) => {
                    const ox = rel ? pen.x : 0;
                    const oy = rel ? pen.y : 0;
                    const x1 = lastControl?.kind === 'c' ? 2 * pen.x - lastControl.x : pen.x;
                    const y1 = lastControl?.kind === 'c' ? 2 * pen.y - lastControl.y : pen.y;
                    pen.cubic(x1, y1, ox + c!, oy + e!, ox + x!, oy + y!);
                    lastControl = { x: ox + c!, y: oy + e!, kind: 'c' };
                });
                break;
            case 'Q':
            case 'T':
                take(C === 'Q' ? 4 : 2).forEach((g) => {
                    const ox = rel ? pen.x : 0;
                    const oy = rel ? pen.y : 0;
                    const [qx, qy] =
                        C === 'Q' ? [ox + g[0]!, oy + g[1]!] : lastControl?.kind === 'q' ? [2 * pen.x - lastControl.x, 2 * pen.y - lastControl.y] : [pen.x, pen.y];
                    const [x, y] = C === 'Q' ? [ox + g[2]!, oy + g[3]!] : [ox + g[0]!, oy + g[1]!];
                    pen.cubic(pen.x + (2 / 3) * (qx! - pen.x), pen.y + (2 / 3) * (qy! - pen.y), x + (2 / 3) * (qx! - x), y + (2 / 3) * (qy! - y), x, y);
                    lastControl = { x: qx!, y: qy!, kind: 'q' };
                });
                break;
            case 'A':
                take(7).forEach(([rx, ry, rot, large, sweep, x, y]) => {
                    pen.arc(rx!, ry!, rot!, !!large, !!sweep, rel ? pen.x + x! : x!, rel ? pen.y + y! : y!);
                });
                lastControl = undefined;
                break;
            case 'Z':
                pen.close();
                lastControl = undefined;
                break;
        }
    }
}

const num = (attrs: Record<string, string>, key: string, fallback = 0) => (attrs[key] !== undefined ? Number(attrs[key]) : fallback);

/** The outline of a named icon, scaled to `size` inches, or undefined when there is no such icon. */
export function iconPoints(name: string, size: number): GeomPoint[] | undefined {
    const inner = ICONS[name.trim().toLowerCase()];
    if (!inner) {
        return undefined;
    }
    const pen = new Pen();
    for (const [, tag, rawAttrs] of inner.matchAll(/<(path|circle|ellipse|rect|line|polyline|polygon)\b([^>]*?)\/?>/g)) {
        const attrs: Record<string, string> = {};
        for (const [, k, v] of rawAttrs!.matchAll(/([\w-]+)="([^"]*)"/g)) {attrs[k!] = v!;}
        switch (tag) {
            case 'path':
                drawPath(pen, attrs.d ?? '');
                break;
            case 'circle':
                pen.ellipse(num(attrs, 'cx'), num(attrs, 'cy'), num(attrs, 'r'), num(attrs, 'r'));
                break;
            case 'ellipse':
                pen.ellipse(num(attrs, 'cx'), num(attrs, 'cy'), num(attrs, 'rx'), num(attrs, 'ry'));
                break;
            case 'rect': {
                const x = num(attrs, 'x');
                const y = num(attrs, 'y');
                const w = num(attrs, 'width');
                const h = num(attrs, 'height');
                const rx = Math.min(num(attrs, 'rx', num(attrs, 'ry')), w / 2);
                const ry = Math.min(num(attrs, 'ry', rx), h / 2);
                drawPath(
                    pen,
                    rx || ry
                        ? `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
                        : `M${x} ${y}H${x + w}V${y + h}H${x}Z`,
                );
                break;
            }
            case 'line':
                pen.move(num(attrs, 'x1'), num(attrs, 'y1'));
                pen.line(num(attrs, 'x2'), num(attrs, 'y2'));
                break;
            case 'polyline':
            case 'polygon': {
                const values = (attrs.points ?? '').trim().split(/[\s,]+/).map(Number);
                for (let k = 0; k + 1 < values.length; k += 2) {
                    if (k === 0) {pen.move(values[0]!, values[1]!);}
                    else {pen.line(values[k]!, values[k + 1]!);}
                }
                if (tag === 'polygon') {pen.close();}
                break;
            }
        }
    }
    const k = size / 24;
    const scale = (v: number) => Math.round(v * k * 10_000) / 10_000;
    return pen.out.map((p) =>
        'close' in p
            ? p
            : 'curve' in p
              ? { x: scale(p.x), y: scale(p.y), curve: { type: 'cubic', x1: scale(p.curve.x1), y1: scale(p.curve.y1), x2: scale(p.curve.x2), y2: scale(p.curve.y2) } }
              : { x: scale(p.x), y: scale(p.y), moveTo: p.moveTo },
    );
}
