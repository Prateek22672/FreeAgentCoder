/** The FreeAgentCoder mark — the same shape as the extension's icon. One place, used everywhere. */
export function Logo({ size = 18, className = 'text-accent' }: { size?: number; className?: string }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor" aria-hidden>
            <path fillRule="evenodd" d="M3 3h13v4H7v9H3zM21 21H8v-4h9V8h4zM10 10h4v4h-4z" />
        </svg>
    );
}
