/**
 * Page recipes: what a given kind of site needs, in order, with what each
 * section must do. Directions say how it looks; recipes say what is on it.
 * Section names match the onboarding's choices where they overlap.
 */

export interface Recipe {
    id: string;
    name: string;
    tags: string[];
    /** Directions that suit it, best first. */
    directions: string[];
    plan: string;
}

export const RECIPES: Recipe[] = [
    {
        id: 'saas',
        name: 'Product or SaaS landing page',
        tags: ['saas', 'software', 'platform', 'app', 'tool', 'product', 'startup', 'api', 'ai', 'waitlist', 'launch'],
        directions: ['cinema', 'glass-dark', 'editorial-light'],
        plan: `1. Nav: brand, 3-4 anchor links, one primary button (PillNav).
2. Hero: a headline under ten words that says the outcome, one sub-line, a primary and a secondary action, a trust line (a number, a rating or "no card needed"), and a live product mock that shows the product doing its job.
3. Proof strip: logos as styled wordmarks or a StatStrip of three real-sounding numbers.
4. Features: 3-6 benefits, each a title that names the gain and one sentence on how; laid out the direction's way (hairline grid, bento, or a rotating-word card).
5. How it works: three or four numbered steps.
6. A deeper moment: one pinned or showcase section that demonstrates the product (a pipeline, a before/after, a ring of capabilities).
7. Pricing: two or three plans with the recommended one marked, a one-line note on what is always included, and annual/monthly only if asked.
8. FAQ: five or six real objections answered plainly (Faq).
9. Final call to action that repeats the promise in new words.
10. Footer: brand, three short link columns, small print.`,
    },
    {
        id: 'agency',
        name: 'Agency or studio site',
        tags: ['agency', 'studio', 'creative', 'marketing', 'branding', 'consult', 'collective', 'production'],
        directions: ['studio-dark', 'quiet-luxury', 'editorial-light'],
        plan: `1. Nav with a contact button.
2. Hero: a big statement of what the studio does and for whom, a short paragraph, two actions, and two or three proof figures.
3. Marquee band of disciplines.
4. About: a three-line headline and a manifesto paragraph (ScrollHighlight), with a numbered approach list beside it.
5. Services: an index list of 5-8 services, each with a one-line tagline and tag chips.
6. Selected work: 4-6 case cards (client type, year, outcome, tags), one pinned or fanned showcase moment.
7. Process: 4-6 numbered steps in a grid.
8. Packages or engagement models, if it sells them.
9. Contact: a short form (name, email, budget, message) beside direct details.
10. Footer.`,
    },
    {
        id: 'portfolio',
        name: 'Personal portfolio',
        tags: ['portfolio', 'resume', 'cv', 'personal', 'freelance', 'designer', 'developer portfolio', 'photographer', 'artist', 'writer'],
        directions: ['studio-dark', 'bright-portfolio', 'editorial-light', 'quiet-luxury'],
        plan: `1. Nav: name as the brand, Work, About, Contact.
2. Hero: the person's name large, what they do in one line, where they are and whether they are available, one action.
3. Selected work: 4-6 projects, each with a title, role, year, a one-line outcome and a visual panel; the first one larger.
4. About: a short story in first person, three strengths, and the tools or skills as tag chips.
5. Experience: a timeline of roles (years, title, company, one achievement each).
6. Testimonials: two or three short quotes with names and roles.
7. Contact: a direct email link, social links, and a short form.
8. Footer.`,
    },
    {
        id: 'property',
        name: 'Real estate, hospitality or premium business',
        tags: ['real estate', 'property', 'villa', 'apartment', 'developer', 'hotel', 'resort', 'restaurant', 'spa', 'wedding', 'interior', 'architect', 'luxury', 'boutique'],
        directions: ['quiet-luxury', 'editorial-light', 'studio-dark'],
        plan: `1. Nav as a slim tab with a phone or booking button.
2. Hero: the place or brand as a large wordmark, one sentence of promise, two actions (enquire, view), and a visual panel.
3. Story: the philosophy in a large two-voice headline, a paragraph, a facts strip of three figures, and an image panel with an overlapping card.
4. Offer: the residences, rooms, menu or services as 3-6 cards with name, a short description, key facts (size, price from, capacity) and an action.
5. Experience or amenities: 4-6 pillars with numerals.
6. Process or journey: numbered steps from first contact to move-in, booking or the day itself.
7. Enquiry form: a short form (name, phone, email, interest as pills, message) beside contact details and opening hours.
8. FAQ.
9. Final call to action band.
10. Footer with address and small print.`,
    },
    {
        id: 'shop',
        name: 'Shop, catalogue or local business',
        tags: ['shop', 'store', 'catalog', 'catalogue', 'products', 'ecommerce', 'bakery', 'cafe', 'café', 'coffee', 'tea', 'florist', 'boutique', 'salon', 'gym', 'studio class', 'local', 'candle', 'clothing', 'fashion', 'skincare', 'cosmetics', 'food', 'restaurant menu', 'subscription box', 'handmade', 'delivery'],
        directions: ['warm-catalog', 'quiet-luxury', 'bright-portfolio'],
        plan: `1. Nav with a cart or contact button, and a bottom action bar on phones.
2. Hero: what is sold and why it is better, one action, and a featured product panel.
3. Categories: 3-6 category cards.
4. Featured products: a grid of product cards (name, short line, price, a quick action), with a search or filter row above if there are many.
5. Why us: three or four promises (quality, delivery, guarantee).
6. Reviews: three short reviews with names.
7. Visit or order: hours, location, delivery areas, and an enquiry form.
8. FAQ.
9. Footer.
State lives in the browser: a working cart or enquiry list kept in localStorage.`,
    },
    {
        id: 'app',
        name: 'Web app that feels like a phone app',
        tags: ['app', 'tracker', 'dashboard', 'booking', 'habit', 'budget', 'fitness', 'notes', 'todo', 'planner', 'timer', 'inventory', 'crm', 'manager', 'calculator', 'quiz', 'game'],
        directions: ['mono-app', 'glass-dark', 'editorial-light'],
        plan: `Build an app, not a landing page.
1. Shell: a phone column with a floating bottom tab bar of 3-5 tabs (the main list or board, add or browse, insights, profile or settings). Each tab is its own component in src/screens/.
2. Home: the one number or item that matters most as a hero card, a status strip, then the list of items as cards, each with a status pill and one action. An empty state that is a dashed card and the call to action.
3. Add or edit: a short form (or a bottom sheet) with sensible defaults, validation shown inline, and a pinned primary button.
4. Insights: a summary card with a big number and a bar, a plain-SVG bar chart of the last 7 or 12 periods with the peak highlighted, and a one-line takeaway.
5. Profile or settings: grouped list cards with switches, and a destructive action that asks first.
6. Data: real working state kept in localStorage behind a small store module (src/store.js) with seed data that shows every state, so it is useful the moment it opens.`,
    },
    {
        id: 'event',
        name: 'Event or launch page',
        tags: ['event', 'conference', 'festival', 'meetup', 'workshop', 'webinar', 'concert', 'launch party', 'summit'],
        directions: ['studio-dark', 'cinema', 'glass-dark'],
        plan: `1. Nav with a ticket button.
2. Hero: the event name huge, date and place, a live countdown, and the ticket action.
3. Marquee of speakers, artists or themes.
4. About the event and who it is for, with three figures (days, talks, attendees).
5. Line-up or speakers as cards.
6. Schedule as a day-by-day list.
7. Tickets: two or three tiers.
8. Venue and travel.
9. FAQ.
10. Footer.`,
    },
];

export function recipeById(id: string): Recipe | undefined {
    return RECIPES.find((r) => r.id === id);
}
