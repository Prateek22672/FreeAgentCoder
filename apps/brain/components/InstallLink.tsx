'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { MARKETPLACE, VSCODE_INSTALL } from '@/lib/site';

/**
 * "Install" that works like the Marketplace's own button: it asks the browser
 * to open VS Code on the extension, where one click on Install finishes it.
 * The Marketplace website never opens.
 *
 * A browser cannot tell a page whether VS Code opened (with no VS Code, the
 * link silently does nothing), so after a click a short note explains the
 * browser's prompt and offers the way through for anyone without VS Code.
 */
export function InstallLink({ className, children, title = 'Install in VS Code' }: { className?: string; children: ReactNode; title?: string }) {
    const [note, setNote] = useState(false);

    useEffect(() => {
        if (!note) return;
        const timer = window.setTimeout(() => setNote(false), 12_000);
        return () => window.clearTimeout(timer);
    }, [note]);

    return (
        <>
            <a href={VSCODE_INSTALL} title={title} onClick={() => setNote(true)} className={className}>
                {children}
            </a>
            {note && (
                <div
                    role="status"
                    className="fixed inset-x-3 bottom-4 z-[60] mx-auto max-w-md rounded-[14px] border border-white/10 bg-[#111113]/95 p-4 text-[13.5px] leading-relaxed text-white shadow-[0_20px_60px_-20px_rgb(0_0_0/0.8)] backdrop-blur"
                >
                    <div className="flex items-start gap-3">
                        <p className="flex-1">
                            <span className="font-semibold">Opening VS Code…</span> If your browser asks, choose <span className="font-semibold">Open Visual Studio Code</span>, then
                            click <span className="font-semibold">Install</span> in VS Code.
                        </p>
                        <button type="button" onClick={() => setNote(false)} aria-label="Close" className="-mr-1 -mt-1 rounded-md px-2 py-1 text-white/50 hover:text-white">
                            ✕
                        </button>
                    </div>
                    <p className="mt-2 text-[12.5px] text-white/55">
                        Nothing happened?{' '}
                        <a href="https://code.visualstudio.com/download" target="_blank" rel="noreferrer noopener" className="text-white underline underline-offset-4">
                            Get VS Code
                        </a>{' '}
                        first, or{' '}
                        <a href={MARKETPLACE} target="_blank" rel="noreferrer noopener" className="text-white underline underline-offset-4">
                            install from the Marketplace
                        </a>
                        .
                    </p>
                </div>
            )}
        </>
    );
}
