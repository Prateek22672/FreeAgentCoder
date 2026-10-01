/**
 * Which AI keys work on a free tier with no card, and which do not, said
 * plainly. Checked against each provider's own pages on 1 October 2026; the
 * extension shows the same list where keys are added.
 */

const FREE = [
    { name: 'Google Gemini', note: 'free daily limit', href: '/go/gemini' },
    { name: 'Groq', note: '1,000 requests a day', href: '/go/groq' },
    { name: 'OpenRouter', note: 'free models, 50 a day', href: '/go/openrouter' },
    { name: 'Cohere', note: '1,000 calls a month, personal use', href: '/go/cohere' },
];

const NOT_FREE = [
    { name: 'Mistral', note: 'refused unless you pick its free plan and verify a phone' },
    { name: 'Cerebras', note: 'needs a card' },
    { name: 'OpenAI', note: 'paid only' },
    { name: 'Anthropic (Claude)', note: 'paid only' },
    { name: 'DeepSeek', note: 'needs a top-up' },
    { name: 'Together AI', note: 'needs a $5 purchase' },
    { name: 'Moonshot (Kimi)', note: 'needs a top-up' },
];

export function FreeKeys({ tone = 'dark' }: { tone?: 'dark' | 'panel' }) {
    const box = tone === 'dark' ? 'border-white/10 bg-white/[0.03] text-white' : 'border-line bg-panel text-fg';
    const dim = tone === 'dark' ? 'text-white/55' : 'text-muted';
    return (
        <div className={`rounded-[16px] border p-5 ${box}`}>
            <p className="text-[15px] font-semibold">Which AI keys work for free</p>
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
                <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#4ade80]">Free, no card needed</p>
                    <ul className="mt-2 space-y-1.5 text-[13.5px]">
                        {FREE.map((k) => (
                            <li key={k.name}>
                                <span className="text-[#4ade80]">✓</span>{' '}
                                <a href={k.href} target="_blank" rel="noreferrer noopener" className="font-medium underline-offset-4 hover:underline">
                                    {k.name}
                                </a>{' '}
                                <span className={dim}>· {k.note}</span>
                            </li>
                        ))}
                    </ul>
                </div>
                <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-400">Not free: these fail without billing</p>
                    <ul className="mt-2 space-y-1.5 text-[13.5px]">
                        {NOT_FREE.map((k) => (
                            <li key={k.name}>
                                <span className="text-amber-400">✕</span> <span className="font-medium">{k.name}</span> <span className={dim}>· {k.note}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
            <p className="mt-4 rounded-[10px] bg-amber-400/10 px-3 py-2 text-[13px] leading-relaxed">
                <strong>Keys copied from websites, videos or GitHub do not work.</strong> <span className={dim}>Providers find and cancel shared keys within hours. Make your own: it takes a minute and is free.</span>
            </p>
        </div>
    );
}
