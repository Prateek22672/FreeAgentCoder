'use client';

import { useEffect } from 'react';

/**
 * The page the in-browser runtime opens when a preview is taken out into its
 * own tab ("Open in a tab"). It connects that tab back to the runtime still
 * running in the playground or workbench tab — which must stay open, since
 * that is where the project actually runs.
 */
export default function Connect() {
    useEffect(() => {
        void import('@webcontainer/api/connect').then(({ setupConnect }) => setupConnect({ editorOrigin: window.location.origin }));
    }, []);
    return (
        <main style={{ display: 'grid', minHeight: '100dvh', placeItems: 'center', fontFamily: 'system-ui, sans-serif', color: '#a1a1aa', background: '#0c0c0d' }}>
            <p>Connecting to the running project… keep the FreeAgentCoder tab open.</p>
        </main>
    );
}
