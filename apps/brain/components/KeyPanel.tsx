'use client';

import { FreeKeys } from './FreeKeys';
import { useState } from 'react';
import { KEY_PROVIDERS, detectProvider, maskKey, providerById, useOwnKey, type KeyProvider } from '@/lib/keys';
import { Icon } from './icons';
import { Button, cx } from './ui';

/**
 * Bring your own free key. The one-key-per-account rule is shown before the
 * links, so nobody opens a second account's worth of signups for nothing.
 */
export function KeyPanel({ reason, onSaved }: { reason?: string; onSaved?: () => void }) {
    const { keys, save, remove } = useOwnKey();
    const [adding, setAdding] = useState(false);
    const [provider, setProvider] = useState<KeyProvider['id']>('gemini');
    const [key, setKey] = useState('');
    const [shown, setShown] = useState(false);
    const [error, setError] = useState<string>();

    const onPaste = (value: string) => {
        setKey(value);
        setError(undefined);
        const detected = detectProvider(value);
        if (detected) setProvider(detected);
    };

    const submit = () => {
        const trimmed = key.trim();
        if (!/^[\x21-\x7e]{16,256}$/.test(trimmed)) {
            setError('That does not look like a whole API key. Copy it again from the provider — it is one long line with no spaces.');
            return;
        }
        save({ provider, key: trimmed });
        setKey('');
        setAdding(false);
        onSaved?.();
    };

    if (keys.length && !adding) {
        const used = new Set(keys.map((k) => k.provider));
        const next = KEY_PROVIDERS.find((p) => !used.has(p.id));
        return (
            <div className="rounded-lg border border-ok/30 bg-ok/10 px-4 py-3 text-sm">
                <p className="flex items-center gap-2 text-fg">
                    <Icon name="check" size={16} className="text-ok" />
                    {keys.length === 1 ? 'Using your own key.' : `Using your ${keys.length} keys. When one reaches its limit, the next takes over.`}
                    <span className="text-faint">Kept in this browser only.</span>
                </p>
                <ul className="mt-2 space-y-1">
                    {keys.map((k) => (
                        <li key={k.key} className="flex items-center gap-3 text-[13px]">
                            <span className="text-fg">{providerById(k.provider)?.label ?? k.provider}</span>
                            <span className="font-mono text-muted">{maskKey(k.key)}</span>
                            <button type="button" onClick={() => remove(k)} className="ml-auto text-[12px] text-muted underline underline-offset-4 hover:text-fg">
                                Remove
                            </button>
                        </li>
                    ))}
                </ul>
                {next && keys.length < 6 && (
                    <button type="button" onClick={() => setAdding(true)} className="mt-2 text-[13px] text-accent underline underline-offset-4">
                        Add a {next.label} key too: its free limit adds to yours
                    </button>
                )}
            </div>
        );
    }

    return (
        <section className="overflow-hidden rounded-lg border border-line-strong bg-panel">
            <header className="border-b border-line px-4 py-3">
                <h3 className="text-[15px] font-semibold text-fg">Use your own free AI key</h3>
                {reason && <p className="mt-1 text-[13px] text-warn">{reason}</p>}
                <p className="mt-1 text-[13px] text-muted">
                    It takes about a minute and costs nothing. Your key is yours: it stays in this browser, is sent over HTTPS only to answer your question, and is never
                    saved on our server.
                </p>
            </header>

            <div className="space-y-4 p-4">
                <div className="flex gap-2.5 rounded-md border border-warn/40 bg-warn/10 px-3 py-2.5 text-[13px] text-fg">
                    <span className="mt-0.5 text-warn" aria-hidden>
                        ⚠
                    </span>
                    <p>
                        <strong>One key per account.</strong> A second key from the same account shares that account&apos;s limits, so it adds nothing — pick a different provider
                        instead. Provider terms don&apos;t allow extra accounts to get around limits.
                    </p>
                </div>

                <ol className="space-y-1.5">
                    {KEY_PROVIDERS.map((p, i) => (
                        <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 rounded-md px-2 py-1.5 hover:bg-panel-2">
                            <span className="text-[13.5px] text-fg">
                                <span className="mr-2 font-mono text-[11px] text-faint">{i + 1}</span>
                                {p.label} <span className="text-[12.5px] text-faint">— {p.goodFor}</span>
                            </span>
                            <a href={p.url} target="_blank" rel="noreferrer noopener" className="text-[13px] text-accent underline underline-offset-4 hover:brightness-110">
                                Get a free key: {p.urlLabel} ↗
                            </a>
                        </li>
                    ))}
                </ol>

                <FreeKeys tone="panel" />

                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        submit();
                    }}
                    className="space-y-2"
                >
                    <label htmlFor="own-key" className="block text-[11px] font-semibold uppercase tracking-wider text-faint">
                        Paste your key
                    </label>
                    <div className="flex flex-wrap gap-2">
                        <select
                            value={provider}
                            onChange={(e) => setProvider(e.target.value as KeyProvider['id'])}
                            aria-label="Provider"
                            className="h-10 rounded-md border border-line-strong bg-bg px-2 text-sm text-fg"
                        >
                            {KEY_PROVIDERS.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.label}
                                </option>
                            ))}
                        </select>
                        <div className="relative min-w-0 flex-1">
                            <input
                                id="own-key"
                                type={shown ? 'text' : 'password'}
                                value={key}
                                onChange={(e) => onPaste(e.target.value)}
                                placeholder="AIza…  gsk_…  csk-…  sk-or-…"
                                autoComplete="off"
                                spellCheck={false}
                                className={cx(
                                    'h-10 w-full rounded-md border bg-bg px-3 pr-16 font-mono text-[13px] text-fg placeholder:text-faint focus:outline-none',
                                    error ? 'border-bad' : 'border-line-strong focus:border-accent',
                                )}
                            />
                            <button type="button" onClick={() => setShown(!shown)} className="absolute inset-y-0 right-2 text-[12px] text-muted hover:text-fg">
                                {shown ? 'Hide' : 'Show'}
                            </button>
                        </div>
                        <Button type="submit" className="h-10" disabled={!key.trim()}>
                            Save key
                        </Button>
                    </div>
                    {error && <p className="text-[12.5px] text-bad">{error}</p>}
                    <p className="text-[12px] text-faint">The provider is picked for you when the key&apos;s prefix shows where it came from.</p>
                </form>
            </div>
        </section>
    );
}
