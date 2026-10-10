import 'server-only';
import { store } from './kv';

/**
 * Where each provider hands out a free key, and how many people got that far.
 *
 * Only a count is kept: the provider, the day, and whether the click came from
 * the extension or the website. No address, no visitor id, nothing that
 * identifies anyone.
 */

export const KEY_LINKS: Record<string, string> = {
    gemini: 'https://aistudio.google.com/apikey',
    groq: 'https://console.groq.com/keys',
    mistral: 'https://console.mistral.ai/api-keys',
    cohere: 'https://dashboard.cohere.com/api-keys',
    openrouter: 'https://openrouter.ai/keys',
    nvidia: 'https://build.nvidia.com/settings/api-keys',
    ollama: 'https://ollama.com/download',
    openai: 'https://platform.openai.com/api-keys',
    anthropic: 'https://platform.claude.com/settings/keys',
};

const DAY_TTL = 90 * 24 * 60 * 60;

function today(offset = 0): string {
    return new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
}

export async function countKeyLink(provider: string, from: 'extension' | 'web'): Promise<void> {
    await store.addCounts(`pb:keylink:${today()}`, { [provider]: 1, [`from-${from}`]: 1, total: 1 }, DAY_TTL);
}

export interface KeyLinkStats {
    total: number;
    fromExtension: number;
    fromWeb: number;
    byProvider: { provider: string; clicks: number }[];
}

export async function readKeyLinks(days = 30): Promise<KeyLinkStats> {
    const parts = await Promise.all(Array.from({ length: days }, (_, i) => store.counts(`pb:keylink:${today(i)}`)));
    const totals: Record<string, number> = {};
    for (const part of parts) {
        for (const [field, value] of Object.entries(part)) {
            totals[field] = (totals[field] ?? 0) + value;
        }
    }
    return {
        total: totals.total ?? 0,
        fromExtension: totals['from-extension'] ?? 0,
        fromWeb: totals['from-web'] ?? 0,
        byProvider: Object.keys(KEY_LINKS)
            .map((provider) => ({ provider, clicks: totals[provider] ?? 0 }))
            .filter((row) => row.clicks > 0)
            .sort((a, b) => b.clicks - a.clicks),
    };
}
