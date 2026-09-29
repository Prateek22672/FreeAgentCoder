import { EXISTING_ARTICLES, type Article, type Block } from './existing';
import { FREE_API_LIMITS } from './free-api-limits';
import { GEMINI_KEY } from './gemini-key';
import { LEAVE_LOVABLE } from './leave-lovable';
import { NEW_ARTICLES } from './new';

export type { Article, Block };

/** Every guide page, in the order they are linked from the home page. */
export const ARTICLES: Article[] = [FREE_API_LIMITS, LEAVE_LOVABLE, GEMINI_KEY, ...NEW_ARTICLES, ...EXISTING_ARTICLES];

export function articleBySlug(slug: string): Article | undefined {
    return ARTICLES.find((a) => a.slug === slug);
}
