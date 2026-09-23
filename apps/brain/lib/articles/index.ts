import { EXISTING_ARTICLES, type Article, type Block } from './existing';
import { NEW_ARTICLES } from './new';

export type { Article, Block };

/** Every guide page, in the order they are linked from the home page. */
export const ARTICLES: Article[] = [...NEW_ARTICLES, ...EXISTING_ARTICLES];

export function articleBySlug(slug: string): Article | undefined {
    return ARTICLES.find((a) => a.slug === slug);
}
