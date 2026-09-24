import type { Metadata } from 'next';
import { Montserrat } from 'next/font/google';
import { DESCRIPTION, INDEXABLE, PRODUCT, SITE_URL } from '@/lib/site';
import './globals.css';

const display = Montserrat({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-montserrat', display: 'swap' });

export const metadata: Metadata = {
    metadataBase: new URL(SITE_URL),
    title: {
        default: 'Free AI Coding Agent for VS Code · FreeAgentCoder',
        template: `%s · ${PRODUCT}`,
    },
    description: DESCRIPTION,
    applicationName: PRODUCT,
    keywords: [
        'free ai coding agent',
        'ai coding agent for vs code',
        'free ai code assistant vscode',
        'free copilot alternative',
        'free cursor alternative',
        'free claude code alternative',
        'open source ai coding agent',
        'chat with github repo',
        'github repo analyzer ai',
        'understand codebase ai',
        'code impact analysis',
        'free gemini api key',
        'byok ai coding',
    ],
    authors: [{ name: 'Kodenza' }],
    creator: 'Kodenza',
    category: 'technology',
    alternates: { canonical: '/' },
    openGraph: {
        type: 'website',
        siteName: PRODUCT,
        title: 'Free AI Coding Agent for VS Code · FreeAgentCoder',
        description: DESCRIPTION,
        url: SITE_URL,
        locale: 'en_US',
    },
    twitter: { card: 'summary_large_image', title: 'Free AI Coding Agent for VS Code', description: DESCRIPTION },
    robots: INDEXABLE
        ? { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 } }
        : { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" className={display.variable}>
            <body className="min-h-screen">{children}</body>
        </html>
    );
}
