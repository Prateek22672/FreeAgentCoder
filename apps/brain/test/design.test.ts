import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readBrief, type Brief } from '../lib/brief';
import { DIRECTIONS, designBrief, hasKit, KIT_FILES, pickDirection, pickRecipe, RECIPES } from '../lib/design';
import { buildSystem, kitChanges, projectContext } from '../lib/playgroundPrompt';
import { starterById } from '../lib/starters';

const brief = (over: Partial<Brief>): Brief => readBrief({ goal: 'website', idea: '', ...over })!;
const pick = (over: Partial<Brief>) => {
    const b = brief(over);
    return `${pickRecipe(b).id} / ${pickDirection(b).id}`;
};

describe('choosing a direction and a recipe', () => {
    it('matches what is being made', () => {
        expect(pick({ idea: 'a site for our luxury villa development in Goa', kind: 'Business site' })).toBe('property / quiet-luxury');
        expect(pick({ idea: 'website for a branding and marketing agency', kind: 'Business site' })).toBe('agency / studio-dark');
        expect(pick({ idea: 'portfolio for my photography', kind: 'Portfolio', style: 'Minimal', theme: 'Dark' })).toBe('portfolio / studio-dark');
        expect(pick({ idea: 'a portfolio for a design student', kind: 'Portfolio', style: 'Playful', theme: 'Light' })).toBe('portfolio / bright-portfolio');
        expect(pick({ idea: 'an online shop for handmade candles', kind: 'Shop' })).toBe('shop / warm-catalog');
        expect(pick({ idea: 'landing page for an AI API for developers', kind: 'Landing page', theme: 'Dark' })).toBe('saas / glass-dark');
        expect(pick({ idea: 'landing page for HR hiring software', kind: 'Landing page', style: 'Corporate', theme: 'Light' })).toBe('saas / editorial-light');
        expect(pick({ idea: 'a landing page for a coffee subscription', kind: 'Landing page', theme: 'Dark' })).toBe('shop / warm-catalog');
        expect(pick({ idea: 'tickets page for a music festival', kind: 'Event' })).toBe('event / studio-dark');
    });

    it('builds an app as an app', () => {
        const app = brief({ goal: 'app', idea: 'a habit tracker that works on my phone', kind: 'Tracker', mobile: true });
        expect(pickRecipe(app).id).toBe('app');
        expect(pickDirection(app).id).toBe('mono-app');
        // Never the phone-app look on a marketing site.
        for (const r of RECIPES.filter((x) => x.id !== 'app')) {
            expect(pickDirection(brief({ idea: 'a dashboard for my tracker app', kind: 'Landing page' }), r).id).not.toBe('mono-app');
        }
    });

    it('has a complete spec for every direction and a plan for every recipe', () => {
        const ids = new Set(DIRECTIONS.map((d) => d.id));
        for (const d of DIRECTIONS) {
            for (const part of ['Fonts:', 'Palette:', 'Type:', 'Layout:', 'Motion:', 'Avoid:']) expect(d.spec, `${d.id} ${part}`).toContain(part);
        }
        for (const r of RECIPES) {
            expect(r.plan.length).toBeGreaterThan(200);
            for (const id of r.directions) expect(ids.has(id), `${r.id} → ${id}`).toBe(true);
        }
    });

    it('puts the person’s choices above the direction’s defaults', () => {
        const text = designBrief(brief({ idea: 'villa rentals', kind: 'Business site', accent: '#2563eb', fonts: 'Sora + Manrope', sections: ['Hero', 'Pricing', 'Contact'], theme: 'Dark' }), true);
        expect(text).toContain('accent #2563eb');
        expect(text).toContain('fonts Sora + Manrope');
        expect(text).toContain('Hero, Pricing, Contact');
        expect(text).toContain('invert its palette');
        expect(text).toContain('src/kit/kit.css');
    });
});

describe('the kit in a project', () => {
    const react = starterById('react')!.files;

    it('is added to a new website, with its stylesheet imported', () => {
        const changes = kitChanges(brief({ idea: 'a bakery' }), react);
        expect(Object.keys(changes).sort()).toEqual([...Object.keys(KIT_FILES), 'src/main.jsx'].sort());
        expect(changes['src/main.jsx']).toContain("import './styles.css';\nimport './kit/kit.css';");
        expect(hasKit({ ...react, ...changes })).toBe(true);
        // Once there, it is not added again.
        expect(kitChanges(brief({ idea: 'a bakery' }), { ...react, ...changes })).toEqual({});
    });

    it('is left out of quick tries and improvements, and of projects with no package.json', () => {
        expect(kitChanges(brief({ goal: 'try', idea: 'x' }), react)).toEqual({});
        expect(kitChanges(brief({ goal: 'improve', idea: 'x' }), react)).toEqual({});
        expect(kitChanges(brief({ idea: 'x' }), { 'index.html': '<p>hi</p>' })).toEqual({});
    });

    it('is not re-sent to the model while unchanged', () => {
        const files = { ...react, ...kitChanges(brief({ idea: 'a bakery' }), react) };
        const context = projectContext(files, 'make the hero bigger');
        expect(context).not.toContain('export function Marquee');
        expect(context).toContain('the kit (src/kit/kit.css, src/kit/motion.jsx, src/kit/ui.jsx)');
        expect(context).toContain('<file path="src/App.jsx">');
        // Changed by hand, it is sent like any other file.
        const edited = projectContext({ ...files, 'src/kit/ui.jsx': `${files['src/kit/ui.jsx']}\n// mine` }, 'x');
        expect(edited).toContain('<file path="src/kit/ui.jsx">');
    });

    it('is described to the agent only when it is there', () => {
        const b = brief({ idea: 'a bakery' });
        expect(buildSystem(b, 'x', react)).not.toContain('# The kit');
        expect(buildSystem(b, 'x', { ...react, ...kitChanges(b, react) })).toContain('# The kit');
        expect(buildSystem(undefined, 'x')).not.toContain('Design direction');
    });

    it('matches its tested sources in design-kit/kit', async () => {
        const dir = path.resolve(__dirname, '../design-kit/kit');
        for (const name of await readdir(dir)) {
            expect(KIT_FILES[`src/kit/${name}`], `run npx tsx scripts/gen-kit.mts`).toBe((await readFile(path.join(dir, name), 'utf8')).replace(/\r\n/g, '\n'));
        }
    });
});
