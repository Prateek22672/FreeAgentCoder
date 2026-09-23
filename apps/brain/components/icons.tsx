/** 16px line icons, drawn for this app. Stroke follows the text colour. */
import type { SVGProps } from 'react';

const PATHS = {
    overview: 'M3 3h7v7H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 14h7v7H3z',
    files: 'M14 3v5h5M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM9 13h6M9 17h6',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
    ask: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12zM9 11h.01M12 11h.01M15 11h.01',
    impact: 'M13 2 4 14h7l-1 8 9-12h-7z',
    layers: 'M12 3 2 8l10 5 10-5zM2 16l10 5 10-5M2 12l10 5 10-5',
    package: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
    branch: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
    close: 'M6 6l12 12M18 6 6 18',
    chevronRight: 'M9 6l6 6-6 6',
    chevronDown: 'M6 9l6 6 6-6',
    folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
    file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5',
    external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
    spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
    check: 'M5 12l5 5 9-10',
    code: 'M8 8l-4 4 4 4M16 8l4 4-4 4M13 5l-2 14',
    copy: 'M9 9h10v10H9zM5 15V5h10',
    arrowRight: 'M5 12h14M13 6l6 6-6 6',
    shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z',
    plan: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
    dependsOn: 'M6 3v6a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v6M15 18l3 3 3-3',
    github: 'M9 19c-4 1.3-4-2-6-2.5m12 5v-3.5a3 3 0 0 0-.9-2.4c3-.3 6-1.5 6-6.6a5 5 0 0 0-1.4-3.6 4.7 4.7 0 0 0-.1-3.5s-1.1-.4-3.7 1.4a12.6 12.6 0 0 0-6.6 0C5.7 1.6 4.6 2 4.6 2a4.7 4.7 0 0 0-.1 3.5A5 5 0 0 0 3 9.1c0 5.1 3 6.3 6 6.6a3 3 0 0 0-.9 2.3V22',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className, ...props }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className={className}
            {...props}
        >
            <path d={PATHS[name]} />
        </svg>
    );
}
