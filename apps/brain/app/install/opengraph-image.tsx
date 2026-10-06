import { ImageResponse } from 'next/og';

export const alt = 'Install FreeAgentCoder, the free AI coding agent for VS Code';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** The card WhatsApp, X and LinkedIn show for the install link: the mark, the name, and one button. */
export default function Image() {
    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'radial-gradient(circle at 50% 45%, #2a1812 0%, #0b0b0d 62%)',
                    color: '#f4f4f5',
                    fontFamily: 'sans-serif',
                }}
            >
                <svg viewBox="0 0 24 24" width={150} height={150} fill="#d97757">
                    <path d="M3 3h13v4H7v9H3z" />
                    <path d="M21 21H8v-4h9V8h4z" />
                    <path d="M10 10h4v4h-4z" />
                </svg>
                <div style={{ marginTop: 34, fontSize: 84, fontWeight: 700, letterSpacing: -2 }}>FreeAgentCoder</div>
                <div style={{ marginTop: 10, fontSize: 36, color: '#a1a1aa' }}>The free AI coding agent for VS Code</div>
                <div
                    style={{
                        marginTop: 44,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 14,
                        padding: '18px 36px',
                        borderRadius: 18,
                        background: '#ffffff',
                        color: '#09090b',
                        fontSize: 34,
                        fontWeight: 700,
                    }}
                >
                    Open in VS Code · free
                </div>
            </div>
        ),
        size,
    );
}
