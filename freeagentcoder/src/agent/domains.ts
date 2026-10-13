import type { RemoteReference } from './remoteConfig';
import type { Blueprint } from './references';

/**
 * Built-in know-how for the most common kinds of project, condensed from how
 * strong open-source projects and well-designed products are put together:
 * folder and route structure, data, APIs, and the UI that separates a
 * professional result from a beginner one. Learned from, never copied: the
 * points describe structure and craft, not anyone's code or text.
 *
 * Kept short because each one that fits is resent on every step of a task.
 * The downloaded library (from the admin page) comes first; these fill in
 * when it has nothing that fits, so even an offline install builds well.
 */

const LANDING: Blueprint = {
    id: 'saas-landing',
    name: 'Product or SaaS landing page',
    match: /\b(?:landing\s*page|home\s*page|marketing\s+(?:site|page)|saas|startup|product\s+(?:site|page)|waitlist|launch\s+page|playground)\b/i,
    points: [
        'Sections in this order, each with one job: nav (logo, 3-5 links, one primary button); hero (a specific headline of 6-10 words, one supporting line, primary and secondary buttons, and a real product visual: a framed screenshot, code sample or illustrated UI, never a stock photo); logos or numbers for proof; 3-6 features as cards with an icon, a short title and one line each; a "how it works" in 3 steps; pricing in 2-3 tiers with the recommended one highlighted; FAQ as accordions; a closing call to action; a footer with columns.',
        'Copy is specific to this product: what it does, for whom, why it is better. No lorem ipsum, no "Welcome to our website", no "Get Started (0)".',
        'A design system first: CSS custom properties for colours, a type scale (e.g. 14/16/20/28/44/64 px), a 4 or 8 px spacing scale, 2-3 radii, one shadow style; then every section uses them.',
        'Layout on a max-width container (1120-1280 px) with generous vertical rhythm (96-128 px between sections on desktop); a 12-column grid that collapses to one column on phones.',
        'Motion with restraint: elements fade and rise 12-16 px as they scroll into view (IntersectionObserver), hover lifts on cards, smooth anchor scrolling; honour prefers-reduced-motion.',
        'Accessible and fast: semantic landmarks, real buttons and links, visible focus, alt text, contrast of 4.5:1, images sized and lazy-loaded, fonts with display=swap.',
        'Meta title and description, Open Graph tags, a favicon, and a mobile menu that works.',
    ],
};

const DASHBOARD: Blueprint = {
    id: 'dashboard',
    name: 'Admin or analytics dashboard',
    match: /\b(?:dashboard|admin\s*(?:panel|portal)?|analytics|back\s*office|crm|internal\s+tool|kpi|reporting)\b/i,
    points: [
        'App shell: a collapsible left sidebar with grouped navigation and icons, a top bar with search, notifications and the user menu, and a content area with a page header (title, description, primary action).',
        'Routes per section (/, /customers, /customers/:id, /orders, /settings) with the list → detail → edit pattern; the URL holds filters, sort and page so views can be shared and reloaded.',
        'Overview page: 4 KPI cards (value, change versus last period with an up or down colour, a sparkline), one main time-series chart, a breakdown chart, and a recent-activity table.',
        'Data tables done properly: sortable columns, search, filters, pagination or virtual scroll, row selection with bulk actions, empty, loading (skeleton rows) and error states.',
        'Forms with labels, inline validation, disabled-while-saving buttons and a toast on success; destructive actions confirm in a dialog.',
        'Charts with a library (Recharts or Chart.js) on one consistent palette, axis labels and tooltips; numbers formatted with Intl.NumberFormat and dates with Intl.DateTimeFormat.',
        'Dark and light themes from the same tokens. Realistic seed data (names, amounts, dates over months), never "Item 1, Item 2".',
    ],
};

const ECOMMERCE: Blueprint = {
    id: 'ecommerce',
    name: 'Online store',
    match: /\b(?:e-?commerce|online\s+(?:store|shop)|shop(?:ping)?\s*(?:cart|site|app)?|storefront|product\s+catalog(?:ue)?|checkout|cart)\b/i,
    points: [
        'Routes: home (featured collections), /products with filters (category, price, size, colour) and sort, /products/:slug, /cart, /checkout, /orders/:id, /account.',
        'Data: products with variants (size, colour) carrying their own price, stock and images; carts and orders store the price at the time of purchase; money as integer cents, formatted per currency.',
        'Product page: an image gallery with thumbnails, title, price (with a compare-at price when on sale), variant pickers that disable out-of-stock options, quantity, Add to cart, shipping and returns notes, reviews.',
        'The cart opens as a slide-over drawer with line items, quantity steppers, subtotal and a checkout button; it survives a reload (localStorage, or a server cart for signed-in users).',
        'Checkout in steps (contact, shipping, payment, review) with an order summary beside it; payments through the provider’s hosted fields or Checkout (Stripe), never card numbers on our server; confirm orders from the webhook, not the redirect.',
        'Server-side price and stock checks on every order; inventory decremented in a transaction.',
        'Product cards with a consistent aspect ratio, hover image swap, badges (New, Sale, Sold out); skeletons while loading; SEO titles, descriptions and Product structured data.',
    ],
};

const PORTFOLIO: Blueprint = {
    id: 'portfolio',
    name: 'Portfolio or personal site',
    match: /\b(?:portfolio|personal\s+(?:site|website|page)|resume\s+(?:site|website)|cv\s+(?:site|website)|agency\s+(?:site|website)|about\s+me\s+page)\b/i,
    points: [
        'A point of view in the first screen: a name, a one-line positioning ("Product designer turning complex tools into calm ones"), and a strong visual or typographic hero, not a centred photo with "Hi, I am".',
        'Selected work as 3-6 case-study cards (image, title, role, year, one-line outcome) leading to case pages: problem, approach, result with numbers, visuals.',
        'About with a short story and skills grouped by area, experience as a timeline, and contact with a mailto link and social links; a downloadable CV.',
        'Typography carries the design: a distinctive display face for headings and a quiet text face, large sizes and tight tracking for headlines.',
        'Tasteful motion: staggered reveal on load, hover previews on project cards, a subtle cursor or underline effect; all off under prefers-reduced-motion.',
        'Content in one data file (projects.json or a typed array), so adding a project is one entry.',
    ],
};

const CONTENT: Blueprint = {
    id: 'blog-docs',
    name: 'Blog, documentation or content site',
    match: /\b(?:blog|documentation\s+site|docs\s+site|knowledge\s+base|news\s+site|magazine|articles?\s+site|markdown\s+site|cms)\b/i,
    points: [
        'Content in Markdown or MDX files with front matter (title, date, description, tags, cover), read at build time; a static generator (Astro or Next.js) when there are many pages, plain HTML only for a handful.',
        'Routes: / (latest and featured), /blog/:slug, /tags/:tag, /about, plus RSS and a sitemap.',
        'Reading layout: 65-75 character lines, 18-20 px body text with 1.6-1.7 line height, clear heading hierarchy, a table of contents for long pages, code blocks with highlighting and a copy button.',
        'Docs: a left navigation tree, a right "on this page" outline, previous and next links, search (Pagefind or a simple index), and versioned paths if there are versions.',
        'Every page has its own title, description, canonical URL and Open Graph image; dates in a readable format; estimated reading time.',
    ],
};

const AUTH: Blueprint = {
    id: 'auth',
    name: 'Sign-up, login and user accounts',
    match: /\b(?:login|log\s*in|sign\s*(?:up|in)|signup|signin|auth(?:entication)?|user\s+accounts?|register|password\s+reset|oauth|jwt)\b/i,
    points: [
        'Use a proven library before writing auth by hand: Auth.js or Lucia for Next.js, Supabase or Firebase Auth for client apps, Passport or better-auth for Express, FastAPI Users or Django auth for Python.',
        'Passwords hashed with argon2 or bcrypt; sessions in HttpOnly, Secure, SameSite cookies (or short-lived access tokens with rotating refresh tokens); CSRF protection on cookie-based forms.',
        'Flows: sign up with email verification, log in, log out, forgot and reset password with a single-use expiring token, change password; optional Google or GitHub sign-in.',
        'Rate-limit login and reset; the same message for an unknown email and a wrong password; lockout or delay after repeated failures.',
        'Protect routes on the server (middleware or a dependency), not just by hiding links; return 401 when signed out and 403 when not allowed.',
        'Forms: labelled inputs, show-password toggle, inline errors, a loading state on submit, and a redirect back to the page the user came from.',
    ],
};

const REALTIME: Blueprint = {
    id: 'realtime-chat',
    name: 'Chat or real-time collaboration app',
    match: /\b(?:chat\s*(?:app|application|room)?|messaging|real-?time|websockets?|socket\.io|live\s+(?:updates|collaboration)|multiplayer|presence)\b/i,
    points: [
        'Transport: WebSockets (Socket.IO, ws, or a hosted channel such as Supabase Realtime or Pusher), with REST for history and the socket only for live events.',
        'Data: users, conversations (direct and group), memberships, messages (id, conversation, author, body, created_at, edited_at, client id for de-duplication); paginate history by cursor, newest at the bottom.',
        'Optimistic sending: show the message at once as pending, reconcile with the server echo by client id, and mark failures with a retry.',
        'Presence, typing indicators and read receipts as separate light events; throttle typing to one event every few seconds.',
        'Reconnect with backoff and resubscribe; fetch what was missed since the last message id.',
        'UI: conversation list with unread counts and last message, message bubbles grouped by author and time, day separators, auto-scroll only when already at the bottom, Enter to send and Shift+Enter for a new line.',
        'Escape or sanitise every message before rendering; validate and rate-limit on the server.',
    ],
};

const MOBILE: Blueprint = {
    id: 'mobile-expo',
    name: 'Mobile app (React Native with Expo)',
    match: /\b(?:mobile\s+app|android\s+app|ios\s+app|iphone\s+app|react\s*native|expo|phone\s+app)\b/i,
    points: [
        'Expo with TypeScript and Expo Router: app/(tabs)/ for the main tabs, app/[id].tsx for details, a root _layout.tsx with providers; components/, hooks/, lib/ beside it.',
        'Native feel: a bottom tab bar of 3-5 tabs with icons, large titles, safe areas respected (SafeAreaView or insets), 44 pt minimum touch targets, haptics on key actions, pull to refresh on lists.',
        'Lists with FlatList or FlashList, never map in a ScrollView; images with expo-image; skeletons while loading and friendly empty states.',
        'State: React Query (TanStack Query) for server data, Zustand or context for app state; persist what must survive restarts with AsyncStorage or expo-secure-store for tokens.',
        'Light and dark themes from one token file; system font sizes respected.',
        'Check it with npx expo-doctor and a TypeScript check, and give the user the command to open it in Expo Go.',
    ],
};

const GAME: Blueprint = {
    id: 'browser-game',
    name: 'Browser game',
    match: /\b(?:game|snake|tetris|chess|sudoku|tic\s*-?tac\s*-?toe|ludo|snakes?\s+and\s+ladders|platformer|arcade|puzzle|quiz\s+game|memory\s+game|flappy|pong|breakout)\b/i,
    points: [
        'Separate the rules from the drawing: a pure game-state module (state, legal moves, apply move, winner) that can be tested, and a renderer (Canvas for action games, DOM or SVG for board and card games).',
        'A fixed-step update loop with requestAnimationFrame and delta time, so speed does not depend on the frame rate; pause when the tab is hidden.',
        'Complete game flow: title screen, how-to-play, playing, paused, game over or win with the score, and restart; the high score kept in localStorage.',
        'Input for keyboard, mouse and touch (on-screen controls on phones); every rule of the game implemented, including the special cases.',
        'Juice: short animations for moves and captures, a little screen shake or flash on big events, sound effects with a mute toggle (Web Audio, no autoplay before a click).',
        'A designed look: a palette and theme that fit the game, a readable HUD, and a layout that scales to the window.',
    ],
};

const ML_APP: Blueprint = {
    id: 'ml-app',
    name: 'Machine-learning or data app',
    match: /\b(?:machine\s+learning|ml\s+(?:model|app|project)|deep\s+learning|neural\s+net|classifier|regression|predict(?:ion|ive)?\s+model|train(?:ing)?\s+a\s+model|streamlit|gradio|data\s+science|dataset|sentiment\s+analysis|recommendation\s+system)\b/i,
    points: [
        'Layout: data/ (raw, processed; large files git-ignored), notebooks/ for exploration only, src/ (data.py, features.py, train.py, evaluate.py, predict.py), models/ for saved artefacts, app.py for the interface, tests/.',
        'Reproducible: fixed random seeds, a config file for paths and hyper-parameters, pinned requirements, and a train/validation/test split made once and saved.',
        'A baseline first (a majority class or linear model), then the real model; report the right metrics for the task (F1 and a confusion matrix for imbalanced classes, MAE or RMSE for regression) on the held-out test set.',
        'Save the full pipeline (preprocessing plus model) with joblib or the framework’s format, and load it in predict.py so the app and training use the same code.',
        'An interface with Streamlit or Gradio: input widgets with sensible defaults, the prediction with its confidence, a short explanation of the model, and example inputs.',
        'Smoke-test on a tiny sample; never train for long or download big datasets without telling the user how long it will take.',
    ],
};

const BOOKING: Blueprint = {
    id: 'booking',
    name: 'Booking, scheduling or reservations',
    match: /\b(?:booking|appointments?|schedul(?:e|ing)|reservations?|calendar\s+app|book\s+a\s+(?:slot|table|room|session)|availability)\b/i,
    points: [
        'Data: resources (people, rooms, tables), availability rules (weekly hours, breaks, exceptions), bookings (resource, start, end, status, customer), all times stored in UTC with the resource’s time zone.',
        'Slots computed on the server from rules minus existing bookings and buffers; the booking is checked again inside a transaction (or with a unique constraint) so two people cannot take the same slot.',
        'Flow: pick a service, pick a date on a month calendar (days with no slots disabled), pick a time from the slot list in the visitor’s time zone, enter details, confirm, then a confirmation page and email with an .ics file.',
        'Reschedule and cancel by a signed link; the owner’s view shows a day or week calendar of bookings.',
        'Handle the edge cases: daylight-saving changes, minimum notice, maximum days ahead, and double-submit.',
    ],
};

export const DOMAIN_BLUEPRINTS: Blueprint[] = [LANDING, DASHBOARD, ECOMMERCE, PORTFOLIO, CONTENT, AUTH, REALTIME, MOBILE, GAME, ML_APP, BOOKING];

/**
 * Visual systems to design from when the downloaded library has no design
 * that fits. Each describes a style in the spirit of products known for it,
 * with concrete tokens, so the result has a real point of view.
 */
export const BUILT_IN_DESIGNS: RemoteReference[] = [
    {
        id: 'dark-product',
        kind: 'design',
        name: 'Dark product launch (in the spirit of Linear and Raycast)',
        tags: ['dark mode', 'saas', 'developer tool', 'product launch', 'startup', 'ai product', 'landing page'],
        points: [
            'Near-black background #0A0A0B with surfaces #111113 and #18181B, borders rgba(255,255,255,0.08); text #EDEDEF, muted #8B8B93; one accent (violet #7C5CFF or a brand colour) used sparingly.',
            'Inter or Geist for everything: hero 64-72 px, weight 600, letter-spacing -0.03em; body 16-17 px; small uppercase labels with 0.08em tracking.',
            'A soft radial glow of the accent behind the hero and a framed product screenshot with a 1 px light border and a large blurred shadow; a faint grid or noise texture.',
            'Cards with 12 px radius, 1 px borders and a subtle gradient border on hover; buttons 36-40 px tall, the primary one light on dark.',
            'Motion: 200-300 ms ease-out fades and rises, a spotlight that follows the cursor on feature cards; nothing bounces.',
        ],
    },
    {
        id: 'clean-fintech',
        kind: 'design',
        name: 'Clean light product site (in the spirit of Stripe)',
        tags: ['light mode', 'fintech', 'payments', 'b2b', 'saas', 'api', 'platform', 'business'],
        points: [
            'White and #F6F9FC backgrounds, ink #0A2540 for headings, slate #425466 for text, an indigo accent #635BFF with a teal or orange second accent.',
            'A diagonal or wavy animated gradient mesh in the hero; content on a 1080-1200 px grid with lots of white space.',
            'Headlines in a geometric sans (Inter, Manrope) at 56-64 px, weight 700, tight leading; body 17-18 px with 1.6 line height.',
            'Feature rows that alternate text and an illustrated UI or code card; cards white with soft shadows (0 30px 60px -30px rgba(50,50,93,.25)) and 8-12 px radius.',
            'Precise details: arrow links that slide on hover, small coloured icons in rounded squares, logos in a muted grey row.',
        ],
    },
    {
        id: 'warm-editorial',
        kind: 'design',
        name: 'Warm editorial (magazines, studios, food, travel)',
        tags: ['editorial', 'blog', 'magazine', 'restaurant', 'food', 'travel', 'hotel', 'studio', 'story', 'wellness', 'fashion', 'serif'],
        points: [
            'Paper background #F7F3EC, ink #1C1A17, warm grey #6B645A, one earthy accent (terracotta #C2562B or olive #5F6F3A).',
            'A characterful serif for headings (Fraunces, Playfair Display or Instrument Serif) at large sizes with italics for emphasis, and a clean sans (Inter) for text.',
            'Asymmetric magazine layouts: big imagery bleeding to the edge, captions in small caps, pull quotes, numbered sections, thin rules between blocks.',
            'Photography warm and natural with consistent cropping; rounded corners small (4-6 px) or none.',
            'Slow, elegant motion: images fade and scale from 1.04 to 1, text lines reveal one by one.',
        ],
    },
    {
        id: 'bold-brutalist',
        kind: 'design',
        name: 'Bold, kinetic portfolio (agencies and creatives)',
        tags: ['portfolio', 'agency', 'creative', 'designer', 'personal', 'bold', 'kinetic typography', 'brutalist'],
        points: [
            'High contrast: off-white #F2F0EB on black #0E0E0E (or the reverse), with one loud accent (acid #D4FF3A or signal orange #FF4D00).',
            'Huge display type (clamp(56px, 10vw, 160px)) in a grotesk such as Space Grotesk or Clash-style faces, set tight; text that scrolls horizontally or splits by letter on scroll.',
            'A visible grid with hairline borders, oversized numbers for sections, project cards that reveal a video or image on hover.',
            'A custom cursor or magnetic buttons, smooth scrolling, sections pinned while their content changes.',
            'Keep it usable: real links, keyboard focus, and reduced motion respected.',
        ],
    },
    {
        id: 'playful-consumer',
        kind: 'design',
        name: 'Friendly consumer app (bright, rounded, approachable)',
        tags: ['consumer', 'education', 'kids', 'fitness', 'habit', 'social', 'community', 'app', 'fun', 'colourful', 'student'],
        points: [
            'Light background #FFFDF8 with bright friendly colours (coral #FF6B5B, sunshine #FFC531, mint #2EC4A0, sky #4D8DFF), each with a role.',
            'Rounded type (Nunito, Poppins or DM Sans) with 600-800 weights; big rounded corners (16-24 px) and pill buttons.',
            'Chunky cards with a 2 px dark border and a hard offset shadow (4px 4px 0 #1B1B1B), or soft pastel cards; illustrations or emoji-like icons.',
            'Delight in the details: buttons that press down, confetti or a little bounce on success, progress rings and streaks.',
            'Copy that sounds human and warm, short sentences, encouraging empty states.',
        ],
    },
    {
        id: 'data-dense',
        kind: 'design',
        name: 'Calm, data-dense dashboard (in the spirit of Vercel and Supabase consoles)',
        tags: ['dashboard', 'admin', 'analytics', 'console', 'internal tool', 'crm', 'monitoring', 'developer dashboard', 'table'],
        points: [
            'Neutral greys (#FAFAFA / #0A0A0A themes) with surfaces one step apart, 1 px borders instead of shadows, and colour only for status (green, amber, red) and one brand accent.',
            'Inter at 13-14 px for UI, tabular numbers for figures, a monospace (JetBrains Mono, Geist Mono) for ids and code.',
            'Compact density: 32-36 px rows and controls, 8 px radius, sticky table headers, a command palette (Ctrl+K).',
            'Charts minimal: no gridline clutter, thin lines, one highlighted series, tooltips with exact values.',
            'Empty, loading and error states designed like real screens, with an action to fix each.',
        ],
    },
    {
        id: 'premium-commerce',
        kind: 'design',
        name: 'Premium commerce (in the spirit of Apple and Aesop product pages)',
        tags: ['ecommerce', 'store', 'shop', 'product', 'luxury', 'fashion', 'beauty', 'furniture', 'retail', 'brand'],
        points: [
            'Restraint: white or warm-neutral backgrounds, near-black text, product photography as the colour; one accent for prices or sale badges.',
            'Large product imagery on clean backgrounds, consistent aspect ratios (4:5 for cards), and full-bleed lifestyle images between sections.',
            'Type: a refined sans (Inter, Neue Haas-style) or a light serif for headings; prices and specs in a clear tabular layout.',
            'Scroll-driven storytelling on product pages: sticky images while feature text scrolls, short benefit headlines.',
            'Frictionless buying: a sticky Add to cart bar on mobile, variant swatches, delivery estimate, trust notes (returns, secure checkout) near the button.',
        ],
    },
    {
        id: 'native-mobile',
        kind: 'design',
        name: 'Native-feeling mobile app (iOS and Material conventions)',
        tags: ['mobile ui', 'react native', 'expo', 'flutter', 'android', 'ios', 'mobile app'],
        points: [
            'Follow the platform: large titles that collapse on scroll, bottom tab bar, sheets that slide up for secondary tasks, swipe actions on list rows.',
            'System font (SF Pro or Roboto) with Dynamic Type sizes; an 8 pt grid; 44-48 pt touch targets; content inside safe areas.',
            'Colour: a neutral base with one brand colour for primary actions; dark mode with true-black or #121212 surfaces.',
            'Cards and lists with 12-16 pt radius, subtle separators, skeleton loading, pull to refresh, haptic feedback on success.',
            'Motion that explains: shared-element transitions to details, springy but quick (250-350 ms) animations.',
        ],
    },
];
