import 'server-only';

/**
 * The public Marketplace numbers for the extension: installs, ratings and the
 * version people are on. These come from Microsoft, not from anything the
 * extension sends, so they cover everyone — including the people who said no
 * to sharing counts.
 */

export const EXTENSION_ID = 'PrateekKoratala.freeagentcoder';
const ENDPOINT = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';

export interface MarketplaceStats {
    installs: number;
    updates: number;
    downloads: number;
    rating: number;
    ratings: number;
    trendingMonthly: number;
    version: string;
    updated?: string;
}

interface QueryResponse {
    results?: {
        extensions?: {
            versions?: { version?: string; lastUpdated?: string }[];
            statistics?: { statisticName?: string; value?: number }[];
        }[];
    }[];
}

export async function marketplaceStats(): Promise<MarketplaceStats | undefined> {
    try {
        const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { accept: 'application/json;api-version=7.2-preview.1', 'content-type': 'application/json' },
            body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: EXTENSION_ID }], pageSize: 1 }], flags: 914 }),
            // Microsoft's numbers move slowly; an hour old is fine and keeps the page fast.
            next: { revalidate: 3_600 },
        });
        if (!response.ok) {
            return undefined;
        }
        const data = (await response.json()) as QueryResponse;
        const extension = data.results?.[0]?.extensions?.[0];
        if (!extension) {
            return undefined;
        }
        const stats = new Map((extension.statistics ?? []).map((entry) => [entry.statisticName ?? '', entry.value ?? 0]));
        return {
            installs: stats.get('install') ?? 0,
            updates: stats.get('updateCount') ?? 0,
            downloads: (stats.get('install') ?? 0) + (stats.get('updateCount') ?? 0),
            rating: stats.get('averagerating') ?? 0,
            ratings: stats.get('ratingcount') ?? 0,
            trendingMonthly: stats.get('trendingmonthly') ?? 0,
            version: extension.versions?.[0]?.version ?? 'unknown',
            updated: extension.versions?.[0]?.lastUpdated,
        };
    } catch {
        return undefined;
    }
}
