'use client';

import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * A column width the person can drag, remembered in this browser. With
 * `fromRight`, dragging left makes the column wider (for a column on the
 * right edge).
 */
export function useDragWidth(key: string, initial: number, min: number, fromRight = false) {
    const [width, setWidth] = useState(initial);

    useEffect(() => {
        try {
            const saved = Number(window.localStorage.getItem(key));
            if (saved >= min) setWidth(saved);
        } catch {
            // No storage: the default width is fine.
        }
    }, [key, min]);

    const onPointerDown = useCallback(
        (event: ReactPointerEvent) => {
            event.preventDefault();
            const startX = event.clientX;
            const start = width;
            // The other columns keep at least 320px between them.
            const max = Math.max(min, window.innerWidth - 320 - (fromRight ? 280 : 320));
            const move = (e: PointerEvent) => {
                const delta = (e.clientX - startX) * (fromRight ? -1 : 1);
                setWidth(Math.min(max, Math.max(min, start + delta)));
            };
            const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                setWidth((w) => {
                    try {
                        window.localStorage.setItem(key, String(Math.round(w)));
                    } catch {}
                    return w;
                });
            };
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        },
        [width, min, fromRight, key],
    );

    return { width, onPointerDown };
}

/** The bar between two columns. Drag it to resize; it lights up under the pointer. */
export function Handle({ onPointerDown, label }: { onPointerDown: (event: ReactPointerEvent) => void; label: string }) {
    return (
        <div
            role="separator"
            aria-label={label}
            aria-orientation="vertical"
            onPointerDown={onPointerDown}
            className="group relative z-10 hidden w-1 shrink-0 cursor-col-resize bg-line transition-colors hover:bg-accent/70 active:bg-accent lg:block"
        >
            <span className="absolute inset-y-0 -left-1 -right-1" />
        </div>
    );
}
