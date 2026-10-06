import type { MetadataRoute } from 'next';
import { ARTICLES } from '@/lib/articles';
import { SITE_URL } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
    const guides = ARTICLES.map((article) => ({
        url: `${SITE_URL}/${article.slug}`,
        lastModified: new Date(article.updated),
        changeFrequency: 'monthly' as const,
        priority: 0.8,
    }));
    return [
        { url: SITE_URL, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 },
        { url: `${SITE_URL}/fyxable`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.9 },
        { url: `${SITE_URL}/install`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
        ...guides,
    ];
}
