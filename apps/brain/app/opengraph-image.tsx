import { ImageResponse } from 'next/og';
import { PRODUCT, TAGLINE } from '@/lib/site';

export const alt = 'FreeAgentCoder — a free AI coding agent for VS Code, and Project Brain for any GitHub repository';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** The link preview card, drawn at build time. */
export default function Image() {
    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    background: 'linear-gradient(135deg, #0b0b0d 55%, #1b1210 100%)',
                    padding: 72,
                    color: '#ececef',
                    fontFamily: 'sans-serif',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 30, color: '#a1a1aa' }}>
                    <div style={{ width: 26, height: 26, background: '#d97757', borderRadius: 6 }} />
                    {PRODUCT}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                    <div style={{ fontSize: 86, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }}>{TAGLINE}</div>
                    <div style={{ fontSize: 34, color: '#a1a1aa', maxWidth: 900, lineHeight: 1.35 }}>
                        Free AI coding agent for VS Code · Chat with any GitHub repo · See what a change breaks
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 28, fontSize: 26, color: '#71717a' }}>
                    <div style={{ display: 'flex' }}>Free · open source</div>
                    <div style={{ display: 'flex' }}>Runs on free API keys</div>
                    <div style={{ display: 'flex' }}>Read-only analysis</div>
                </div>
            </div>
        ),
        size,
    );
}
