import type { MetadataRoute } from 'next';
import { INDEXABLE, SITE_URL } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
    if (!INDEXABLE) {
        // A temporary address. Nothing here should be indexed under a name the
        // site is about to leave.
        return { rules: [{ userAgent: '*', disallow: '/' }] };
    }
    return {
        rules: [
            {
                userAgent: '*',
                allow: '/',
                // Analyses are built for one visitor, live an hour, and would be thin, duplicate pages.
                disallow: ['/api/', '/r/', '/admin'],
            },
        ],
        sitemap: `${SITE_URL}/sitemap.xml`,
        host: SITE_URL,
    };
}
