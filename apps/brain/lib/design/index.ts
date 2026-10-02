import type { Brief } from '../brief';
import { DIRECTIONS, directionById, type Direction } from './directions';
import { KIT_FILES } from './kitFiles';
import { RECIPES, recipeById, type Recipe } from './recipes';

/**
 * The design library: for a website or app brief, the direction (how it
 * looks) and the recipe (what is on it), chosen from the brief's words, plus
 * the kit every such project starts with.
 */

export { KIT_FILES } from './kitFiles';
export { DIRECTIONS } from './directions';
export { RECIPES } from './recipes';

/** The kit's own files; the agent imports them and never rewrites them. */
export const KIT_PREFIX = 'src/kit/';

export function hasKit(files: Record<string, string>): boolean {
    return Object.keys(KIT_FILES).every((file) => file in files);
}

/** Goals whose projects are built on the kit. */
export function usesKit(brief: Brief | undefined): boolean {
    return brief?.goal === 'website' || brief?.goal === 'app' || brief?.goal === 'ml';
}

const STYLE_HINTS: Record<string, string[]> = {
    minimal: ['editorial-light', 'quiet-luxury', 'glass-dark', 'mono-app'],
    bold: ['studio-dark', 'cinema', 'glass-dark'],
    playful: ['bright-portfolio', 'warm-catalog'],
    corporate: ['editorial-light', 'warm-catalog', 'glass-dark'],
    editorial: ['quiet-luxury', 'editorial-light', 'studio-dark'],
};

function score(text: string, tags: string[]): number {
    return tags.reduce((sum, tag) => sum + (new RegExp(`\\b${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(text) ? (tag.includes(' ') ? 3 : 2) : 0), 0);
}

/** The recipe for a brief: the page plan that fits what is being made. */
export function pickRecipe(brief: Brief): Recipe {
    if (brief.goal === 'app' || brief.goal === 'ml') return recipeById('app')!;
    const text = `${brief.kind ?? ''} ${brief.idea}`;
    const kind = (brief.kind ?? '').toLowerCase();
    if (/portfolio/.test(kind)) return recipeById('portfolio')!;
    if (/shop/.test(kind)) return recipeById('shop')!;
    if (/event/.test(kind)) return recipeById('event')!;
    if (/business/.test(kind) && !/agency|studio/i.test(brief.idea)) {
        // A business site is the place-led recipe when it is about a venue, else the agency one.
        return score(brief.idea, recipeById('property')!.tags) >= score(brief.idea, recipeById('agency')!.tags) ? recipeById('property')! : recipeById('agency')!;
    }
    const ranked = RECIPES.filter((r) => r.id !== 'app')
        .map((r) => ({ r, s: score(text, r.tags) }))
        .sort((a, b) => b.s - a.s);
    return ranked[0]!.s > 0 ? ranked[0]!.r : recipeById('saas')!;
}

/**
 * The direction for a brief. The recipe's suitable directions come first; the
 * brief's words, style and theme then pick among all of them, so a dark
 * bakery or a playful studio still gets a fitting look.
 */
export function pickDirection(brief: Brief, recipe: Recipe = pickRecipe(brief)): Direction {
    const text = `${brief.kind ?? ''} ${brief.idea}`;
    const style = (brief.style ?? '').toLowerCase();
    const theme = (brief.theme ?? '').toLowerCase();
    const ranked = DIRECTIONS.map((d) => {
        let s = score(text, d.tags);
        const place = recipe.directions.indexOf(d.id);
        if (place >= 0) s += 6 - place * 2;
        const hinted = STYLE_HINTS[style]?.indexOf(d.id) ?? -1;
        if (hinted >= 0) s += 4 - hinted;
        if (theme && d.theme !== 'either') s += d.theme === theme ? 2 : -3;
        if (d.id === 'mono-app' && recipe.id !== 'app') s -= 8;
        return { d, s };
    }).sort((a, b) => b.s - a.s);
    return ranked[0]!.d;
}

export const KIT_API = `The kit (already in the project, in src/kit/; import from it and never rewrite or re-create these files):
- src/kit/kit.css is imported once in src/main.jsx. It reads your tokens: --bg, --ink, --accent, --on-accent, --line, --muted, so define those on :root in src/styles.css.
- import { Lines, Reveal, Stagger, WordCycle, Marquee, CountUp, Pinned, useScrollProgress, span, ease, ScrollHighlight, useInView } from './kit/motion.jsx'
  <Lines as="h1" lines={['Built to', <em>outlast</em>, 'trends.']} className="..." /> masked line reveal, one line per entry, staggered.
  <Reveal as="p" delay={120}>…</Reveal> fades and rises in on entering the view.  <Stagger className="grid">{cards}</Stagger> reveals children in turn.
  <WordCycle words={['homes','studios','cafés']} className="accent" /> cycles a word inside a sentence; the sentence reflows.
  <Marquee items={['Design','Build','Launch']} duration={28} reverse={false} /> an endless band; speeds up with scrolling.
  <CountUp to={240} format={(n) => Math.round(n) + '+'} /> counts up when seen.
  <Pinned height="260vh">{(p) => <Scene progress={p} />}</Pinned> a sticky full-screen scene driven by scroll progress p (0..1); span(p, a, b) maps part of it to 0..1 and ease() decelerates.
  <ScrollHighlight text="…" accent={['purpose']} /> words light up as it is read.
- import { PillNav, Faq, StatStrip } from './kit/ui.jsx'
  <PillNav brand="Name" links={[{ href: '#work', label: 'Work' }]} cta={{ href: '#contact', label: 'Contact' }} /> floating nav that turns light over sections marked data-nav="light"; folds into a menu on phones.
  <Faq items={[{ q, a }]} />  <StatStrip stats={[{ value: <CountUp to={12} />, label: 'Years' }]} />
- CSS classes: k-cells (1px hairline grid; set grid-template-columns), k-cta (pill button: <a className="k-cta">Book <i>→</i></a>; set --cta-bg and --cta-fg), k-wipe (hover fill), k-glass, k-grain (place inside a position:relative section), k-cue (scroll cue line).
- Everything in the kit already honours prefers-reduced-motion.`;

/** The design part of the agent's instructions for a website or app brief. */
export function designBrief(brief: Brief, kit: boolean): string {
    const recipe = pickRecipe(brief);
    const direction = pickDirection(brief, recipe);
    const sections = brief.sections?.length ? `\nThe person chose these sections, in this order, which replace the recipe's list where they differ: ${brief.sections.join(', ')}.` : '';
    const accent = brief.accent ? `\nThe person chose the accent ${brief.accent}: use it in place of the direction's accent.` : '';
    const fonts = brief.fonts ? `\nThe person chose the fonts ${brief.fonts}: use them in place of the direction's fonts.` : '';
    const theme = brief.theme && direction.theme !== 'either' && brief.theme.toLowerCase() !== direction.theme ? `\nThe person asked for a ${brief.theme.toLowerCase()} theme: keep the direction's structure and voice, and invert its palette.` : '';
    return [
        `# Design direction: ${direction.name}`,
        `Made for ${direction.fits}. Follow it exactly: it is a complete visual language taken from finished, professional sites.`,
        direction.spec + accent + fonts + theme,
        `# Page plan: ${recipe.name}`,
        recipe.plan + sections,
        kit ? `# ${KIT_API}` : '',
        `# How to build it
- Structure: src/styles.css holds the design tokens (CSS custom properties for every colour, the fonts, the type scale, spacing, radii and shadows) and the base styles; each section is its own component in src/sections/ with its own small CSS file next to it, imported by the component; src/App.jsx only composes the sections in order. Load the direction's fonts with one <link> in index.html, with preconnect.
- Write real copy for this business, in its own voice: specific names, numbers, places, products and promises that fit the idea. Never lorem ipsum, "Your Company", "Feature 1" or leftovers from the starter.
- Make the first build complete: every section in the plan, the nav, the footer, phone and desktop layouts. A full first version is worth more than a careful half.
- Check before answering: no section left as a stub, every import points to a file you wrote or a kit file, every kit component is used with the props shown, the page works at 390px and at 1440px.`,
    ]
        .filter(Boolean)
        .join('\n\n');
}

export { directionById, recipeById };
