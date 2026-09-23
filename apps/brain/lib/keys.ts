'use client';

/**
 * A visitor's own AI key, kept in this browser only. It is sent with each
 * question over HTTPS, used for that one request, and never stored on the
 * server. Storage can be unavailable (private windows, blocked site data), so
 * every access is guarded and the page works without it.
 */
import { useCallback, useEffect, useState } from 'react';

export interface KeyProvider {
    id: 'gemini' | 'groq' | 'cerebras' | 'openrouter' | 'mistral';
    label: string;
    url: string;
    urlLabel: string;
    goodFor: string;
    prefix?: RegExp;
}

/** Strongest free option for reading code first. */
export const KEY_PROVIDERS: KeyProvider[] = [
    { id: 'gemini', label: 'Google Gemini', url: 'https://aistudio.google.com/apikey', urlLabel: 'aistudio.google.com/apikey', goodFor: 'Best for large codebases — reads a lot of code at once', prefix: /^AIza/ },
    { id: 'groq', label: 'Groq', url: 'https://console.groq.com/keys', urlLabel: 'console.groq.com/keys', goodFor: 'Very fast answers to short questions', prefix: /^gsk_/ },
    { id: 'cerebras', label: 'Cerebras', url: 'https://cloud.cerebras.ai', urlLabel: 'cloud.cerebras.ai', goodFor: 'Fast, with a generous free tier', prefix: /^csk-/ },
    { id: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/keys', urlLabel: 'openrouter.ai/keys', goodFor: 'Free models from several makers behind one key', prefix: /^sk-or-/ },
    { id: 'mistral', label: 'Mistral', url: 'https://console.mistral.ai/api-keys', urlLabel: 'console.mistral.ai/api-keys', goodFor: 'A solid all-rounder' },
];

export function detectProvider(key: string): KeyProvider['id'] | undefined {
    return KEY_PROVIDERS.find((p) => p.prefix?.test(key.trim()))?.id;
}

export interface StoredKey {
    provider: KeyProvider['id'];
    key: string;
}

const STORAGE = 'projectBrain.ownKey';
const CHANGED = 'projectbrain:key';

function read(): StoredKey | undefined {
    try {
        const raw = window.localStorage.getItem(STORAGE);
        const parsed = raw ? (JSON.parse(raw) as StoredKey) : undefined;
        return parsed && KEY_PROVIDERS.some((p) => p.id === parsed.provider) && typeof parsed.key === 'string' ? parsed : undefined;
    } catch {
        return undefined;
    }
}

/** The saved key, kept in sync across every component on the page. */
export function useOwnKey(): { own?: StoredKey; save: (value: StoredKey) => boolean; clear: () => void } {
    const [own, setOwn] = useState<StoredKey>();
    useEffect(() => {
        setOwn(read());
        const sync = () => setOwn(read());
        window.addEventListener(CHANGED, sync);
        window.addEventListener('storage', sync);
        return () => {
            window.removeEventListener(CHANGED, sync);
            window.removeEventListener('storage', sync);
        };
    }, []);
    const save = useCallback((value: StoredKey) => {
        try {
            window.localStorage.setItem(STORAGE, JSON.stringify(value));
        } catch {
            // Storage blocked: keep it for this page only.
            setOwn(value);
            return false;
        }
        window.dispatchEvent(new Event(CHANGED));
        return true;
    }, []);
    const clear = useCallback(() => {
        try {
            window.localStorage.removeItem(STORAGE);
        } catch {
            // nothing stored
        }
        setOwn(undefined);
        window.dispatchEvent(new Event(CHANGED));
    }, []);
    return { own, save, clear };
}

export const maskKey = (key: string) => `····${key.slice(-4)}`;

export function providerById(id: string): KeyProvider | undefined {
    return KEY_PROVIDERS.find((p) => p.id === id);
}
