/**
 * How well a request fits a reference, from the words they share. Tags are
 * short phrases ("smart parking", "role based access control"); a phrase
 * found whole counts most, and each distinct tag or name word found counts
 * once. Words every request has ("build", "app") are ignored.
 */

const COMMON = new Set(
    'a an and are as at be build built by can create for from get have in into is it its make me my new of on or our please should so that the their this to use using want we will with you your app apps application project page pages site website web system simple'.split(
        ' ',
    ),
);

export function words(text: string): Set<string> {
    const out = new Set<string>();
    for (const raw of text.toLowerCase().split(/[^a-z0-9.#+-]+/)) {
        const word = raw.replace(/^[.\-]+|[.\-]+$/g, '');
        if (word.length >= 2 && !COMMON.has(word)) out.add(word);
    }
    return out;
}

export function matchScore(text: string, tags: string[], name = ''): number {
    const lower = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
    const have = words(text);
    let score = 0;
    for (const tag of tags) {
        if (tag.includes(' ') && lower.includes(` ${tag} `)) score += 2;
    }
    const wanted = words(`${tags.join(' ')} ${name}`);
    for (const word of wanted) {
        if (have.has(word)) score += 1;
    }
    return score;
}

/** Enough shared words to be about the same thing, not one coincidence. */
export const MATCH_THRESHOLD = 3;

export function bestMatches<T>(items: T[], text: string, describe: (item: T) => { tags: string[]; name: string }, limit: number): T[] {
    return items
        .map((item) => {
            const { tags, name } = describe(item);
            return { item, score: matchScore(text, tags, name) };
        })
        .filter((x) => x.score >= MATCH_THRESHOLD)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((x) => x.item);
}
