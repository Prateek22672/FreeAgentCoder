'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

/**
 * The workbench layout: three slots (left, centre, right) holding the agent,
 * the code and the preview in any order. Drag a panel by its grip onto
 * another slot to swap them; drag a divider to resize; double-click a divider
 * to fit the panels to the window again. The side panels keep the width you
 * gave them, the centre takes the rest, and on a narrower window everything
 * is squeezed back into view. Panels move with CSS `order`, so they stay
 * mounted: a running preview keeps running when it moves.
 */

export type PanelId = 'chat' | 'code' | 'preview';
export type Slot = 0 | 1 | 2;

// v2: the preset changed to code, preview, agent; earlier saved layouts start from it once.
const ORDER_KEY = 'fyxable.layout.order.v2';
const WIDTH_KEY = 'fyxable.layout.widths.v2';
/** The preset: the code on the left, the running app large in the centre, the agent on the right. */
const DEFAULT_ORDER: PanelId[] = ['code', 'preview', 'chat'];
/** The centre never gets narrower than this. */
const MIN_CENTER = 320;
const MIN_SIDE = 260;
const HANDLE = 4;

/** A good width for a panel at the side of a row this wide. */
function fitted(panel: PanelId, row: number): number {
    const share = panel === 'chat' ? 0.27 : panel === 'preview' ? 0.4 : 0.34;
    const preferred = panel === 'chat' ? 500 : panel === 'preview' ? 560 : 660;
    return Math.round(Math.max(MIN_SIDE, Math.min(preferred, row * share)));
}

function load<T>(key: string, check: (value: unknown) => value is T): T | undefined {
    try {
        const value = JSON.parse(window.localStorage.getItem(key) ?? 'null') as unknown;
        return check(value) ? value : undefined;
    } catch {
        return undefined;
    }
}

function save(key: string, value: unknown): void {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // No storage: the layout is kept for this visit.
    }
}

const isOrder = (v: unknown): v is PanelId[] =>
    Array.isArray(v) && v.length === 3 && DEFAULT_ORDER.every((p) => v.includes(p));
const isWidths = (v: unknown): v is Record<PanelId, number> =>
    !!v && typeof v === 'object' && DEFAULT_ORDER.every((p) => typeof (v as Record<string, unknown>)[p] === 'number');

export interface Layout {
    /** Put on the row that holds the three slots. */
    rowRef: (el: HTMLDivElement | null) => void;
    order: PanelId[];
    slotOf(panel: PanelId): Slot;
    /** Style for a panel: its place in the row and, at the sides, its width. */
    panelStyle(panel: PanelId): CSSProperties;
    /** Pointer handler for the divider between two slots (0 = left|centre, 1 = centre|right). */
    resize(divider: 0 | 1): (event: ReactPointerEvent) => void;
    fit(): void;
    move(panel: PanelId, to: Slot): void;
    /** Starts dragging a panel by its grip. */
    startDrag(panel: PanelId, event: ReactPointerEvent): void;
    dragging?: PanelId;
    /** The slot the dragged panel would land in. */
    target?: Slot;
}

export function useLayout(): Layout {
    // The row appears only once a project is open, so it is tracked as state, not read once on mount.
    const rowEl = useRef<HTMLDivElement | null>(null);
    const [rowNode, setRowNode] = useState<HTMLDivElement | null>(null);
    const rowRef = useCallback((el: HTMLDivElement | null) => {
        rowEl.current = el;
        setRowNode(el);
    }, []);
    const [order, setOrder] = useState<PanelId[]>(DEFAULT_ORDER);
    const [widths, setWidths] = useState<Record<PanelId, number>>({ chat: 460, code: 600, preview: 520 });
    const [dragging, setDragging] = useState<PanelId>();
    const [target, setTarget] = useState<Slot>();

    useEffect(() => {
        const savedOrder = load(ORDER_KEY, isOrder);
        if (savedOrder) setOrder(savedOrder);
        const savedWidths = load(WIDTH_KEY, isWidths);
        if (savedWidths) setWidths(savedWidths);
    }, []);

    // Auto fit: on a narrower window the sides give way so the centre stays usable.
    const [row, setRow] = useState(0);
    useEffect(() => {
        if (!rowNode) return;
        if (!load(WIDTH_KEY, isWidths)) {
            const total = rowNode.clientWidth;
            setWidths({ chat: fitted('chat', total), code: fitted('code', total), preview: fitted('preview', total) });
        }
        setRow(rowNode.clientWidth);
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(([entry]) => setRow(entry!.contentRect.width));
        observer.observe(rowNode);
        return () => observer.disconnect();
    }, [rowNode]);
    const sideWidth = useCallback(
        (panel: PanelId, otherSide: PanelId) => {
            if (!row) return widths[panel];
            const room = row - MIN_CENTER - HANDLE * 2;
            const mine = widths[panel];
            const other = widths[otherSide];
            if (mine + other <= room) return mine;
            // Squeeze both sides in proportion, never below their minimum.
            return Math.max(MIN_SIDE, Math.floor((mine / (mine + other)) * room));
        },
        [row, widths],
    );

    const slotOf = useCallback((panel: PanelId) => order.indexOf(panel) as Slot, [order]);

    const panelStyle = useCallback(
        (panel: PanelId): CSSProperties => {
            const slot = slotOf(panel);
            const style: CSSProperties = { order: slot * 2 };
            if (slot === 1) return { ...style, flex: '1 1 0', minWidth: 0 };
            const other = order[slot === 0 ? 2 : 0]!;
            return { ...style, flex: `0 0 ${sideWidth(panel, other)}px`, minWidth: 0 };
        },
        [order, slotOf, sideWidth],
    );

    const setAndSave = (next: Record<PanelId, number>) => {
        setWidths(next);
        save(WIDTH_KEY, next);
    };

    const resize = useCallback(
        (divider: 0 | 1) => (event: ReactPointerEvent) => {
            event.preventDefault();
            const panel = order[divider === 0 ? 0 : 2]!;
            const other = order[divider === 0 ? 2 : 0]!;
            const startX = event.clientX;
            const start = sideWidth(panel, other);
            const total = rowEl.current?.clientWidth ?? window.innerWidth;
            const max = Math.max(MIN_SIDE, total - MIN_CENTER - sideWidth(other, panel) - HANDLE * 2);
            let latest = widths;
            const onMove = (e: PointerEvent) => {
                const delta = (e.clientX - startX) * (divider === 0 ? 1 : -1);
                latest = { ...latest, [panel]: Math.round(Math.min(max, Math.max(MIN_SIDE, start + delta))) };
                setWidths(latest);
            };
            const onUp = () => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                save(WIDTH_KEY, latest);
            };
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        },
        [order, sideWidth, widths],
    );

    const fit = useCallback(() => {
        const total = rowEl.current?.clientWidth ?? window.innerWidth;
        setAndSave({ chat: fitted('chat', total), code: fitted('code', total), preview: fitted('preview', total) });
    }, []);

    const move = useCallback(
        (panel: PanelId, to: Slot) => {
            const from = order.indexOf(panel);
            if (from === to || from < 0) return;
            const next = [...order];
            [next[from], next[to]] = [next[to]!, next[from]!];
            setOrder(next);
            save(ORDER_KEY, next);
        },
        [order],
    );

    const startDrag = useCallback(
        (panel: PanelId, event: ReactPointerEvent) => {
            if (event.button !== 0) return;
            event.preventDefault();
            const rect = rowEl.current?.getBoundingClientRect();
            if (!rect) return;
            const slotAt = (x: number) => Math.min(2, Math.max(0, Math.floor(((x - rect.left) / rect.width) * 3))) as Slot;
            setDragging(panel);
            setTarget(slotAt(event.clientX));
            let last = slotAt(event.clientX);
            const onMove = (e: PointerEvent) => {
                last = slotAt(e.clientX);
                setTarget(last);
            };
            const onUp = () => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                document.body.style.cursor = '';
                setDragging(undefined);
                setTarget(undefined);
                move(panel, last);
            };
            document.body.style.cursor = 'grabbing';
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        },
        [move],
    );

    return { rowRef, order, slotOf, panelStyle, resize, fit, move, startDrag, dragging, target };
}

const NAMES: Record<PanelId, string> = { chat: 'Agent', code: 'Code', preview: 'Preview' };
const SLOT_NAMES = ['left', 'centre', 'right'];

/** The handle a panel is dragged by. Arrow keys move it too. */
export function Grip({ panel, layout }: { panel: PanelId; layout: Layout }) {
    const slot = layout.slotOf(panel);
    const onKey = (event: ReactKeyboardEvent) => {
        if (event.key === 'ArrowLeft' && slot > 0) layout.move(panel, (slot - 1) as Slot);
        else if (event.key === 'ArrowRight' && slot < 2) layout.move(panel, (slot + 1) as Slot);
        else return;
        event.preventDefault();
    };
    return (
        <button
            type="button"
            onPointerDown={(e) => layout.startDrag(panel, e)}
            onKeyDown={onKey}
            title={`Drag to move ${NAMES[panel]} to another side (or use the arrow keys)`}
            aria-label={`Move the ${NAMES[panel]} panel, now on the ${SLOT_NAMES[slot]}`}
            className="hidden h-6 w-5 shrink-0 cursor-grab touch-none place-items-center rounded text-faint hover:bg-panel-2 hover:text-fg active:cursor-grabbing lg:grid"
        >
            <svg viewBox="0 0 10 16" width={8} height={13} fill="currentColor" aria-hidden>
                {[3, 8, 13].map((y) => (
                    <g key={y}>
                        <circle cx="2.5" cy={y} r="1.3" />
                        <circle cx="7.5" cy={y} r="1.3" />
                    </g>
                ))}
            </svg>
        </button>
    );
}

/** The divider between two slots: drag to resize, double-click to fit. */
export function Handle({ layout, divider }: { layout: Layout; divider: 0 | 1 }) {
    return (
        <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Drag to resize; double-click to fit"
            title="Drag to resize · double-click to fit"
            onPointerDown={layout.resize(divider)}
            onDoubleClick={layout.fit}
            style={{ order: divider * 2 + 1 }}
            className="group relative z-10 hidden w-1 shrink-0 cursor-col-resize bg-line transition-colors hover:bg-accent/70 active:bg-accent lg:block"
        >
            <span className="absolute inset-y-0 -left-1.5 -right-1.5" />
        </div>
    );
}

/** While a panel is dragged: three drop zones over the row, the one under the pointer lit. */
export function DropZones({ layout }: { layout: Layout }): ReactNode {
    const dragged = layout.dragging;
    if (!dragged) return null;
    return (
        <div className="pointer-events-none absolute inset-0 z-30 hidden grid-cols-3 gap-2 bg-bg/40 p-2 backdrop-blur-[1px] lg:grid" aria-hidden>
            {[0, 1, 2].map((slot) => {
                const occupant = layout.order[slot]!;
                const on = layout.target === slot;
                return (
                    <div
                        key={slot}
                        className={`flex items-center justify-center rounded-xl border-2 border-dashed text-[13px] font-semibold transition-colors ${on ? 'border-accent bg-accent/15 text-fg' : 'border-line-strong text-faint'}`}
                    >
                        {on
                            ? occupant === dragged
                                ? `Keep ${NAMES[dragged]} here`
                                : `Put ${NAMES[dragged]} here · ${NAMES[occupant]} moves`
                            : SLOT_NAMES[slot]![0]!.toUpperCase() + SLOT_NAMES[slot]!.slice(1)}
                    </div>
                );
            })}
        </div>
    );
}
