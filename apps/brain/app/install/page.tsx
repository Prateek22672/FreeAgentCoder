import type { Metadata } from 'next';
import { canonical, PRODUCT } from '@/lib/site';
import { InstallLanding } from './landing';

const TITLE = `Install ${PRODUCT}: the free AI coding agent for VS Code`;
const BLURB = 'Plans, writes, runs and tests code in your project on free Gemini, Groq and OpenRouter keys. No subscription. Opens straight in VS Code.';

/**
 * The link to share (WhatsApp, X, LinkedIn, email): a page with a proper
 * preview card that opens VS Code on the extension by itself, so people never
 * see the Marketplace page, and that still helps anyone on a phone or without
 * VS Code.
 */
export const metadata: Metadata = {
    title: { absolute: TITLE },
    description: BLURB,
    alternates: { canonical: canonical('/install') },
    openGraph: { title: TITLE, description: BLURB, url: canonical('/install'), type: 'website', siteName: PRODUCT },
    twitter: { card: 'summary_large_image', title: TITLE, description: BLURB },
};

export default function InstallPage() {
    return <InstallLanding />;
}
