import type { Metadata } from 'next';
import { Playground } from '@/components/playground/Playground';

export const metadata: Metadata = {
    title: 'Free AI Code Playground — Build and Run Apps in Your Browser',
    description:
        'Describe an app and a free AI agent writes it, then runs it live in your browser. React, HTML or Node — no sign-in, no GitHub, no install. Uses your own free API key.',
    alternates: { canonical: '/playground' },
};

export default function PlaygroundPage() {
    return <Playground />;
}
