/**
 * Design directions: complete visual languages distilled from real, finished
 * sites (studied in websites/_reports). Each is specific enough to build
 * from: fonts, palette, type, layout, surfaces, motion, and what to avoid.
 * One is chosen per brief and handed to the agent whole, so a site has one
 * coherent voice instead of an average of every pattern.
 */

export interface Direction {
    id: string;
    name: string;
    /** When it fits, for choosing and for the agent. */
    fits: string;
    /** Words in a brief that point here. */
    tags: string[];
    theme: 'dark' | 'light' | 'either';
    spec: string;
}

export const DIRECTIONS: Direction[] = [
    {
        id: 'quiet-luxury',
        name: 'Quiet luxury editorial',
        fits: 'real estate, architecture, interiors, hotels, restaurants, wine, jewellery, weddings, premium services',
        tags: ['real estate', 'property', 'villa', 'apartment', 'architect', 'interior', 'hotel', 'resort', 'restaurant', 'fine dining', 'wine', 'jewel', 'wedding', 'luxury', 'premium', 'spa', 'boutique', 'developer', 'gallery', 'atelier', 'law', 'wealth'],
        theme: 'light',
        spec: `Fonts: Instrument Serif 400 roman and italic for all display text; DM Sans 300/400/500/600 for everything else (body is 300). One Google Fonts <link> in index.html with preconnect.
Palette: bone #F4F2EC page, cream #E8E5D8 text on dark, warm black #0E0E0E ink and dark sections, gold #C9A96E accent (hover #E0B97C), stone #8A8578 muted. Every other tint is an alpha of these, never a new hue.
Type: hero wordmark ~21vw, line-height .82, letter-spacing -0.065em, allowed to bleed off the frame. H2 clamp(2.6rem,5vw,5.2rem), lh .95, ls -.04em. Body .95-1.05rem weight 300, lh 1.85, max 480px. Eyebrows .62rem, 500, ls .25em, uppercase gold, led by a 30px x 1px gold line.
Signature heading: a roman word then an italic word in stone on light (gold on dark): "Featured <em>residences</em>".
Layout: hero is a rounded 20px card inside a 10px page margin, full height, a dark gradient over a rich background, content anchored bottom-left with a 400px column bottom-right. Sections 9rem/4rem padding, 1360px max. Two-column grids with 5-6rem gaps. Use overlap: a dark card hanging off an image corner, ghost numerals at 3% opacity, the nav as a dark tab hanging from the top edge.
Surfaces: hairlines (1px rgba(10,10,10,.1)), facts strips built with the k-cells 1px-gap grid, underline-only form inputs that turn gold on focus, pill buttons, square form card. Shadows only on floating dark cards (0 48px 80px -24px rgb(0 0 0/.32)).
Texture: k-grain at .06 on the hero and .03 on bone sections; a faint gold radial glow on dark sections; dot grid radial-gradient(rgba(201,169,110,.07) 1px, transparent 1px) 40px on dark.
Motion: slow and decelerating, nothing bounces. Lines for every headline, Reveal/Stagger for copy and cards, imagery scaling 1.12 to 1 over 2.4s, WordCycle for one italic gold word in a subline, Faq for questions.
Imagery: no photos are available, so make visual panels from layered gradients in the palette (warm black to bronze, bone to stone) with grain and a thin gold inset border, labelled as places for the owner's photos.
Avoid: saturated colours, gradient buttons, emoji, bold sans headlines, centred walls of text.`,
    },
    {
        id: 'studio-dark',
        name: 'Studio editorial, dark',
        fits: 'agencies, studios, creative portfolios, marketing, events, personal brands, music',
        tags: ['agency', 'studio', 'creative', 'marketing', 'brand', 'branding', 'design studio', 'portfolio', 'freelance', 'photographer', 'photography', 'film', 'music', 'artist', 'event', 'festival', 'conference', 'production', 'media', 'collective'],
        theme: 'dark',
        spec: `Fonts: Syne 400-800 for display; Outfit 200-600 for body (300 default); Space Grotesk 400-500 for nav and buttons; Fira Code 300-400 for labels, indices and meta. Load all four in one Google Fonts <link>.
Palette: near-blacks stepped per section so stacked sections read as layers: #050505, #0b0b0b, #111111, #0d0d0d, #000. Text on dark in tiers of rgb(245 242 236 / .3, .55, .7, 1). One hot accent (default #EE7435, or the brief's accent) used for labels, one marquee band, focus states and the last line of key headlines. The hero may be paper #EEE9DF with ink #1B2632 for contrast.
Type: display clamp(3rem,7.5vw,7.5rem), lh .9, ls -.05em, often uppercase. Headlines mix voices: line one weight 400 italic at 35% opacity (or outlined with -webkit-text-stroke 1.5px and transparent fill), line two weight 800 solid. Section labels are mono .7rem, ls .2em, accent, numbered and led by a 40px line: "02 — What we do". Body Outfit 300, lh 1.8, max 36ch.
Layout: every section min-height 100vh, flex column, justify-content space-between, padding clamp(5rem,10vw,7rem) 4vw 4vw, with full-width 1px hairlines (rgb(245 242 236 / .07)) between label, headline and content. Services as an index list: grid 60px 1fr auto, mono id, title with an italic tagline, square mono tag chips; hover adds a 2px accent bar on the left. Pricing and process as k-cells grids with ghost numerals at 4% in each cell.
Surfaces: square corners for cells, inputs, tags and badges; pills only for primary buttons. Cards only for showcase work (radius 18px, shadow 0 30px 70px rgb(0 0 0/.35), lifting on hover).
Texture: k-grain at .04; an 80px line grid at 2% opacity in the hero.
Motion: Lines on every headline (stagger 90ms), Stagger on lists, two Marquee bands in opposite directions (one on the accent colour with black text), ScrollHighlight for the manifesto paragraph, k-wipe fill on service rows and cards. Use Pinned for one showcase moment (cards fanning out with progress).
Avoid: rounded cards everywhere, gradients on text, more than one accent, a hidden cursor.`,
    },
    {
        id: 'editorial-light',
        name: 'Editorial light',
        fits: 'B2B software, HR, finance, health, education, consulting, blogs, research, nonprofits',
        tags: ['saas', 'b2b', 'software', 'platform', 'hr', 'hiring', 'recruit', 'finance', 'fintech', 'bank', 'accounting', 'health', 'clinic', 'doctor', 'therapy', 'education', 'course', 'school', 'consult', 'blog', 'newsletter', 'research', 'nonprofit', 'charity', 'legal'],
        theme: 'light',
        spec: `Fonts: Switzer 300/400/500/600 from Fontshare (<link href="https://api.fontshare.com/v2/css?f[]=switzer@300,400,500,600&display=swap" rel="stylesheet">) with Inter as the fallback. Headings are weight 300; that is the look.
Palette: pure white and black, greys only as black alpha (text rgb(0 0 0/.52), faint .3, hairlines .08). One soft accent family; default sage: fill #CAE8A6, dark #3D6B22 for text, #4A8A2A for checks (or derive a pale fill and a dark text tone from the brief's accent). A signature band: linear-gradient(160deg, pale accent, slightly deeper accent) used to bookend the page (hero foot and final CTA) with a line-art SVG motif drawn in thin strokes at 10-30% opacity.
Type: hero h1 clamp(3rem,6.9vw,7rem), weight 300, ls -.03em, lh 1.1. Statement lines clamp(2.8rem,6vw,6.2rem), ls -.045em, lh 1.02. H2 clamp(2rem,4vw,3.8rem). Body 15px weight 300, lh 1.75. Eyebrows 10px, 500, ls .12em, uppercase at 50% black, followed by a 1px rule that runs to the edge.
Layout: container 1280px with 32-64px side padding; sections 96-144px vertical padding. Hero split: white top with the headline bottom-left and, on the right, a 1px x 88px vertical rule, a 280px paragraph and two stacked 250px square CTAs (arrow pushed right); the accent band below it with a 4-column metrics row anchored to its bottom.
Surfaces: zero radius everywhere (square buttons, cells, tags); features as a hairline grid (k-cells) with 01-06 numbers and small line icons, never shadowed cards. One section inverts to black with the same hairline grid at white 8% and big accent numerals.
Motion: restraint. Lines for a four-line statement (stagger 115ms, translateY 60px), Stagger for grid cells (80ms), Reveal elsewhere, StatStrip with CountUp in the metrics row.
Avoid: rounded corners, drop shadows, gradients outside the signature band, bold headings, more than one accent.`,
    },
    {
        id: 'glass-dark',
        name: 'Glass, dark',
        fits: 'developer tools, AI products, APIs, infrastructure, security, crypto, data platforms',
        tags: ['developer', 'dev tool', 'api', 'sdk', 'infrastructure', 'cloud', 'devops', 'ai', 'llm', 'agent', 'model', 'machine learning', 'data', 'analytics', 'security', 'crypto', 'web3', 'blockchain', 'voice', 'automation', 'open source', 'cli'],
        theme: 'dark',
        spec: `Fonts: Inter (Google) 400/500/600, or Geist if the brief asks for it; tabular numbers for stats.
Palette: pure #000 background, white text, greys as white alpha (body /60, labels /40, borders /10, card fill /3). Status colours only for status: emerald #34D399, red #E5484D, amber #E3B341. One accent at most, used sparingly.
Type: h1 clamp(2.6rem,7vw,4.6rem), weight 600, ls -.03em, lh 1.08, with one word filled by a vertical gradient (linear-gradient(#fff,#fff6) with background-clip text). Sub-headline weight 300. Labels 11px uppercase ls .08em.
Layout: container 1152px, 24-40px side padding, sections stacked 80-120px apart. Hero min-height 85vh, centred: an eyebrow pill (border white/10, bg white/5, a green dot), the h1, a paragraph, three buttons (white pill primary, glass outline, ghost text), and below them a glass stat strip (StatStrip inside a container with border white/10 and backdrop-filter blur).
Surfaces: everything round: pill buttons and nav items, 16px cards, 12px inner tiles. Glass recipe: border 1px rgb(255 255 255/.1), background rgb(255 255 255/.03), backdrop-filter blur(20px); hover border /.2 and fill /.05. Primary button glows: box-shadow 0 0 24px rgb(255 255 255/.15), rising on hover. A pipeline strip of chips joined by arrows explains how it works.
Background: beams made of a rotated repeating-linear-gradient of faint white bars, blurred 10px, masked by a radial gradient and drifting slowly (14s alternate), with a black gradient over the lower half for legibility. A 48px line grid masked to fade out from the top is a good second texture.
Motion: shimmer sweep across the primary button on hover (a skewed light band moving from -60% to 130% over 700ms), Reveal and Stagger for cards, CountUp for numbers, a live pulsing status dot.
Avoid: colourful gradients, light sections, square corners, serif fonts.`,
    },
    {
        id: 'cinema',
        name: 'Cinema product launch',
        fits: 'consumer apps, product launches, AI assistants, mobile apps, hardware, startups that want a showpiece',
        tags: ['app', 'launch', 'product', 'startup', 'assistant', 'mobile app', 'download', 'waitlist', 'beta', 'hardware', 'device', 'gadget', 'subscription', 'productivity', 'tool'],
        theme: 'dark',
        spec: `Fonts: Inter Tight 500/600 (Google) for all display text, the system UI stack for body, ui-monospace for eyebrows (11px uppercase ls .22em at 50% opacity).
Palette: page light grey #EFEFF2; deep black #070708 and panel #181818 for dark scenes; graphite and silver materials; one warm accent (default coral #D97757 with a light tint #FFD2BF, or the brief's accent). Success green #4ADE80 only for checks.
Type: hero clamp(2.9rem,9.2vw,7.4rem), weight 600, lh .95, ls -.035em, written as a two-tone headline: line one white, line two white at 45%. Section h2 clamp(2.2rem,5vw,3.8rem) weight 500, also two-tone. A kinetic marquee line at clamp(5rem,15vw,13rem), ls -.05em.
Layout: the page is a stack of rounded "slides": full-bleed sections drawn as 22-28px rounded cards inset 8-12px from the page edge. Hero: a graphite card (radial-gradient(70% 55% at 50% 118%, #cdcdd48c, transparent 62%), radial-gradient(55% 60% at 0 0, #5c5c64d9, transparent 70%), linear-gradient(165deg,#2c2c31,#151517 45%,#080809)) with the headline top-left, a paragraph and buttons bottom-left, and a live product mock on the right: a dark panel (radius 16, border white/10, shadow 0 40px 90px -30px #000e) that types a request, shows steps appearing with checks, and loops.
Surfaces: materials as CSS: chrome conic-gradient(from 210deg at 62% 45%, #f5f5f7, #9d9da6, #ececf0, #6f6f78, #dcdce2, #a8a8b2, #f5f5f7); a warm card radial coral top-right and violet bottom-left over linear-gradient(135deg,#1a0f1f,#2a1320 45%,#3a1a14). Buttons 12-14px radius; the primary is white with shadow 0 14px 40px -12px rgb(0 0 0/.6) and scales 1.03 on hover.
Motion: Pinned scenes carry the page: the hero content scales from 1 to .8 and drifts down as you scroll; a 3D ring of feature cards turns with progress over a huge Marquee line; a kinetic statement where two halves of a sentence slide in from opposite sides. A rotating-word feature card (WordCycle) whose side mock changes with the word. PillNav that turns light over sections marked data-nav="light".
Avoid: flat white pages, stock illustration, more than one accent, long paragraphs.`,
    },
    {
        id: 'warm-catalog',
        name: 'Warm catalogue',
        fits: 'shops, product catalogues, manufacturers, cafés, bakeries, florists, salons, local services, home and furniture',
        tags: ['shop', 'store', 'catalog', 'catalogue', 'products', 'manufacturer', 'furniture', 'home decor', 'kitchen', 'cafe', 'café', 'coffee', 'bakery', 'florist', 'salon', 'barber', 'tailor', 'local', 'delivery', 'menu', 'grocery', 'organic', 'handmade', 'craft'],
        theme: 'light',
        spec: `Fonts: Inter Tight or Manrope (Google) 400/500/600 with font-feature-settings "ss01","cv11"; headings weight 500 with letter-spacing -0.02em and text-wrap: balance; labels 600.
Palette: warm cream paper #ECEAE3 page, darker cream #E3E0D7 for alternate sections and image wells, white #FFF for cards, warm near-black ink #16150F for text and primary buttons, charcoal #1C1B18 for the footer, the reviews band and the final call to action, hairlines #D6D2C7. The brand accent (default warm yellow #EDCD1F, or the brief's accent) covers about 1% of the page: star ratings, icon tiles, selection. Greys are ink at 40/55/65%.
Type: display h1 clamp(2.4rem,5.6vw,4.8rem) weight 500, lh .98. H2 clamp(2.2rem,4.6vw,4rem) lh 1. Body 17px, relaxed. Eyebrow above every heading: 11px uppercase 600, ls .2em, ink 45%, led by a 32px x 1px line. Ghost step numbers 110px at 9% ink.
Layout: container 1280px with 20-48px side padding; sections 80-112px. The nav starts as a full-width frosted bar and becomes a floating pill once scrolled. The hero is a large visual panel (88vh) with the headline bottom-left and a row of three checkmarked trust points; the content below rises over it as a sheet with rounded top corners. Categories as rounded image-well cards; products as white cards (12px radius) showing the product whole, name clamped to two lines, price, a quick action. A search field and category pills overlap the edge of the section above.
Surfaces: pills for every button, chip and search field. Radii: product cards 12, category cards 16, service cards 24, panels 28-32. Big soft shadows pulled in with negative spread: cards 0 2px 6px rgb(28 27 27/.05), 0 18px 40px -16px rgb(28 27 27/.18); hover 0 22px 50px -32px rgb(20 20 15/.5). Every button lifts 2px on hover; arrows nudge up and right.
Conversion: a glass bottom bar (Call, and an ink "Get a quote" or "Order") floating 16px above the bottom of the screen; a multi-step enquiry wizard with progress pills and a success tick, reachable from the hero, every product and the footer.
Motion: one easing curve (cubic-bezier(.16,1,.3,1)). Reveal rises 18px over .7s, Stagger by column 60-70ms, CountUp for figures, a slow Marquee of reviews or partner names that pauses on hover, WordCycle for one word in the hero.
Imagery: visual wells made from warm gradients with soft shapes and the product name, clearly meant for the owner's photos.
Avoid: cold greys, more than one bright colour, square buttons, hard drop shadows.`,
    },
    {
        id: 'bright-portfolio',
        name: 'Bright and friendly',
        fits: 'playful brands, student and junior portfolios, kids and family, wellness, community, personal sites, creators',
        tags: ['playful', 'fun', 'friendly', 'student', 'kids', 'family', 'community', 'creator', 'youtube', 'influencer', 'wellness', 'yoga', 'pet', 'personal site', 'hobby'],
        theme: 'light',
        spec: `Fonts: Plus Jakarta Sans 400-800 (Google) for everything, or Sora for headings; body 16-17px.
Palette: off-white #F8F9FA page, near-black #111 text, one vivid accent (default violet #8B5CF6) with a second hue for gradients (blue #3B82F6, or fuchsia then orange #F97316). Gradients only on accent words, glows and one hero card: linear-gradient(135deg, violet, fuchsia, orange).
Type: hero in two lines, the name or promise first, the second line at 40% opacity and slightly smaller; clamp(3rem,8vw,6.5rem), weight 800, ls -.04em, lh .95. Section headings in two lines with the second filled by the accent gradient (background-clip text). Small uppercase pills for labels.
Layout: container 1200px; sections 96-128px. Hero full height with a huge soft accent glow (a 600px blurred circle at 20%) that slowly pulses, the headline on the left, a 4:5 visual panel on the right with a gradient glow behind it, and a line like "Based in X • Available worldwide" at the bottom. About as a 12-column bento (a 7-wide and a 5-wide card). Work as very rounded cards with a gradient wash and a ghost initial. A full-width gradient card with a glass box holding "Current focus".
Surfaces: generous rounding (24-32px cards, pill buttons and chips), glass chips with a pulsing green "available" dot, buttons with a coloured shadow matching the accent (0 12px 30px -10px accent at 60%).
Motion: playful but quick: Reveal rising 30px, Stagger 80ms, WordCycle for roles, cards lifting 8px on hover, a bobbing scroll hint.
Avoid: dark sections everywhere, serif fonts, grey corporate tones, tiny type.`,
    },
    {
        id: 'mono-app',
        name: 'Monochrome app',
        fits: 'web apps that should feel like a phone app: trackers, dashboards, booking, fitness, finance, habits, notes, tools',
        tags: ['tracker', 'dashboard', 'booking', 'reservation', 'fitness', 'workout', 'habit', 'budget', 'expense', 'finance app', 'notes', 'todo', 'to-do', 'planner', 'timer', 'parking', 'calendar', 'inventory', 'crm', 'mobile', 'phone app'],
        theme: 'dark',
        spec: `Fonts: Switzer 400-900 from Fontshare (<link href="https://api.fontshare.com/v2/css?f[]=switzer@400,500,600,700,800,900&display=swap" rel="stylesheet">), fallback system-ui. tabular-nums on every number.
Palette: OLED monochrome. bg #000, surface #0D0D0D (cards, inputs, sheets), surface-2 #111 (pills, chips), track #1A1A1A, borders #1C1C1C / #222 / #2A2A2A, text tiers #333 (eyebrows), #555 (secondary), #888, #FFF. No hues except one live green dot #4ADE80. The only emphasis is inversion: the one thing that matters in a region is solid white with black text (the active item, the primary button, the selected tile, the best option). A light theme swaps the tokens and the inversion becomes solid black.
Type: a tiny dim eyebrow (10px, 800, ls 2px, uppercase, #333) over a huge tight title (30px, 900, ls -.5px). Hero numbers 52-56px/900, ls -2px. Card titles 15-17px/800. Body 13-15px. Buttons 15px/900.
Layout: a phone column (max-width 430px, centred on desktop, 100dvh) with 20px gutters, content starting 56px from the top and padded 120px at the bottom to clear a floating tab bar. No top header bar: each screen draws its own large title, with a 42px round icon button or a status chip on the right. Blocks 16-20px apart.
Navigation: a floating blurred bottom tab bar (rgba(10,10,10,.82), backdrop blur, top radius 20) with 3-5 tabs; the active tab is a white pill whose label grows out of it and whose icon pops (scale 1.12, then back). Choices open in a bottom sheet (top radius 28, a 36x4 handle, option rows with chevrons, a text Cancel). The primary action pins just above the tab bar.
Surfaces: everything is a card with a 1px border and almost no shadow. Radii grow with size: badge 6, chip 10, tile 14, input and button 16, stat pill 18, card 22, hero card 26, sheet 28. Inputs: #0D0D0D, radius 16, a leading icon, border and icon turning white on focus, 16px text (so iOS does not zoom).
States: a dashed-border empty card that is also the call to action, a spinner inside the button while saving, an inline error line, bars that fill from 0 over 900ms, live LIVE/AWAY tags, grouped list cards with hairlines between rows and switches (on = white track, black thumb).
Motion: each screen's blocks fade and rise 14px, 60-80ms apart (Stagger); presses squash to .96 (tiles .88); nothing blocks input.
Web details: viewport-fit=cover, env(safe-area-inset-*) padding, overscroll-behavior contain, hidden scrollbars, -webkit-tap-highlight-color transparent, 44px touch targets. Data in localStorage.
Avoid: colour for decoration, a desktop-style top nav, hover-only controls, shadows, tables at phone width.`,
    },
];

export function directionById(id: string): Direction | undefined {
    return DIRECTIONS.find((d) => d.id === id);
}
