import type { Metadata } from 'next';
import { Playground } from '@/components/playground/Playground';

export const metadata: Metadata = {
    title: 'Fyxable — Free AI App Builder, No Credits, in Your Browser',
    description:
        'Fyxable, by Free Agent Coder: describe an app and an AI agent builds it and runs it live in your browser. On your own free Gemini, Groq or OpenRouter keys: no credits, no install, export any time. A free Lovable and Bolt alternative.',
    alternates: { canonical: '/fyxable' },
};

export default function FyxablePage() {
    return <Playground />;
}
