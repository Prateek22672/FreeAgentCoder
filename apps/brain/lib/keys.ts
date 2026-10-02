'use client';

/**
 * A visitor's own AI key, kept in this browser only. It is sent with each
 * question over HTTPS, used for that one request, and never stored on the
 * server. Storage can be unavailable (private windows, blocked site data), so
 * every access is guarded and the page works without it.
 */
import { useCallback, useEffect, useState } from 'react';

export interface KeyProvider {
    id: 'gemini' | 'groq' | 'openrouter' | 'mistral';
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
    { id: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/keys', urlLabel: 'openrouter.ai/keys', goodFor: 'Free models from several makers behind one key', prefix: /^sk-or-/ },
];

export function detectProvider(key: string): KeyProvider['id'] | undefined {
    return KEY_PROVIDERS.find((p) => p.prefix?.test(key.trim()))?.id;
}

export interface StoredKey {
    provider: KeyProvider['id'];
    key: string;
}

const STORAGE = 'projectBrain.ownKeys';
const OLD_STORAGE = 'projectBrain.ownKey';
const CHANGED = 'projectbrain:key';
/** Several keys from different providers add up their free limits. */
export const MAX_KEYS = 6;

const valid = (k: unknown): k is StoredKey =>
    !!k && typeof k === 'object' && KEY_PROVIDERS.some((p) => p.id === (k as StoredKey).provider) && typeof (k as StoredKey).key === 'string';

function read(): StoredKey[] {
    try {
        const raw = window.localStorage.getItem(STORAGE);
        if (raw) {
            const list = JSON.parse(raw) as unknown[];
            return Array.isArray(list) ? list.filter(valid).slice(0, MAX_KEYS) : [];
        }
        // A single key saved by an earlier version of the site.
        const old = window.localStorage.getItem(OLD_STORAGE);
        const parsed = old ? (JSON.parse(old) as unknown) : undefined;
        return valid(parsed) ? [parsed] : [];
    } catch {
        return [];
    }
}

function write(list: StoredKey[]): boolean {
    try {
        window.localStorage.setItem(STORAGE, JSON.stringify(list));
        window.localStorage.removeItem(OLD_STORAGE);
        return true;
    } catch {
        return false;
    }
}

/**
 * The saved keys, kept in sync across every component on the page. `own` is
 * the first one, for places that show a single key.
 */
export function useOwnKey(): {
    own?: StoredKey;
    keys: StoredKey[];
    save: (value: StoredKey) => boolean;
    remove: (value: StoredKey) => void;
    clear: () => void;
} {
    const [keys, setKeys] = useState<StoredKey[]>([]);
    useEffect(() => {
        setKeys(read());
        const sync = () => setKeys(read());
        window.addEventListener(CHANGED, sync);
        window.addEventListener('storage', sync);
        return () => {
            window.removeEventListener(CHANGED, sync);
            window.removeEventListener('storage', sync);
        };
    }, []);
    const save = useCallback((value: StoredKey) => {
        const list = [...read().filter((k) => k.key !== value.key), value].slice(-MAX_KEYS);
        const ok = write(list);
        setKeys(list);
        window.dispatchEvent(new Event(CHANGED));
        return ok;
    }, []);
    const remove = useCallback((value: StoredKey) => {
        const list = read().filter((k) => k.key !== value.key);
        write(list);
        setKeys(list);
        window.dispatchEvent(new Event(CHANGED));
    }, []);
    const clear = useCallback(() => {
        write([]);
        setKeys([]);
        window.dispatchEvent(new Event(CHANGED));
    }, []);
    return { own: keys[0], keys, save, remove, clear };
}

/** Request headers for the visitor's keys: all of them, so the server can switch between them. */
export function ownKeyHeaders(keys: StoredKey[]): Record<string, string> {
    if (!keys.length) return {};
    return { 'x-brain-provider': keys[0]!.provider, 'x-brain-key': keys[0]!.key, 'x-brain-keys': JSON.stringify(keys.map((k) => [k.provider, k.key])) };
}

export const maskKey = (key: string) => `····${key.slice(-4)}`;

export function providerById(id: string): KeyProvider | undefined {
    return KEY_PROVIDERS.find((p) => p.id === id);
}
