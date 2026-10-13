import { describe, expect, it } from 'vitest';
import { blueprintsFor, isSpec, referenceBlock } from './references';

const SPEC = `ACXIOMCRM CRM Project Documentation. Functional Requirements: Validation, Security, Authorization, API, Reports.
5. Validation Requirements. Client-side validation is required; server-side validation is mandatory.
17.4 Use ASP.NET Core Identity for users, password hashing, roles and lockout. Mandatory module tree.
17.17 Minimum Evaluation Criteria. 17.19 Final Acceptance Scenario. Each module must support CRUD.
${'Opportunity amount must be greater than 0. '.repeat(40)}`;

describe('references', () => {
    it('treats an attached requirements document as a spec and finds the ASP.NET blueprint', () => {
        expect(isSpec('build this project', SPEC)).toBe(true);
        const block = referenceBlock('build this project as per the attached document', SPEC);
        expect(block).toContain('REQUIREMENTS.md');
        expect(block).toContain('override SaveChangesAsync');
        expect(blueprintsFor(SPEC).map((b) => b.id)[0]).toBe('aspnet-mvc');
    });

    it('adds nothing to an ordinary request', () => {
        expect(isSpec('add a dark mode toggle to the header')).toBe(false);
        expect(referenceBlock('add a dark mode toggle to the header')).toBe('');
    });

    it('finds the backend blueprint for a role-based app in another stack', () => {
        expect(blueprintsFor('build an inventory system with role-based access in FastAPI').map((b) => b.id)).toEqual(['api-backend']);
    });
});

describe('the downloaded library', () => {
    const library = [
        { id: 'crm', kind: 'blueprint' as const, name: 'ASP.NET Core Identity CRM Pattern', tags: ['asp.net core 8', 'crm', 'identity', 'role based access control', 'audit logging'], points: ['Audit inside SaveChangesAsync.'] },
        { id: 'parking', kind: 'design' as const, name: 'Dark Industrial Smart Parking Interface', tags: ['smart parking', 'dark mode', 'realtime dashboard'], points: ['Monochrome surfaces with one signal colour.'] },
    ];

    it('uses a downloaded blueprint before the built-in ones', () => {
        const block = referenceBlock('build a CRM with Identity, role based access control and audit logging in ASP.NET', '', library);
        expect(block).toContain('Audit inside SaveChangesAsync.');
        expect(block).not.toContain('override SaveChangesAsync, read ChangeTracker');
    });

    it('adds a design reference only to work on how something looks', () => {
        expect(referenceBlock('design a dark smart parking dashboard', '', library)).toContain('learn from, not to copy');
        expect(referenceBlock('fix the smart parking slot count bug', '', library)).toBe('');
    });

    it('always picks a design for a new thing with a screen, for the same platform', () => {
        const designs = [
            ...library,
            { id: 'agency', kind: 'design' as const, name: 'Kinetic Brutalist Agency Portfolio', tags: ['next.js', 'marketing agency', 'kinetic typography'], points: ['Oversized type that moves with the scroll.'] },
            { id: 'habits', kind: 'design' as const, name: 'Habit tracker mobile app', tags: ['react native', 'expo', 'mobile ui'], points: ['Thumb-reach bottom actions.'] },
        ];
        expect(referenceBlock('build a playground site for web ideas', '', designs)).toContain('learn from, not to copy');
        expect(referenceBlock('make an android app to plan meals', '', designs)).toMatch(/Thumb-reach bottom actions\.|Follow the platform/);
        expect(referenceBlock('make a todo website', '', designs)).not.toContain('Thumb-reach');
    });
});

describe('built-in domain know-how', () => {
    it('gives a landing page its sections and a design, with no library at all', () => {
        const block = referenceBlock('build a playground site for web ideas with a get started button');
        expect(block).toContain('Product or SaaS landing page');
        expect(block).toContain('never a stock photo');
        expect(block).toContain('learn from, not to copy');
    });

    it('fits the domain: a dashboard, a store, a game, a mobile app', () => {
        expect(referenceBlock('create an analytics dashboard for sales')).toMatch(/Admin or analytics dashboard[\s\S]*data-dense dashboard/i);
        expect(referenceBlock('build an online store for shoes with a cart')).toContain('Online store');
        expect(referenceBlock('make a snake game in the browser')).toContain('Browser game');
        expect(referenceBlock('build a react native expo app for habits')).toMatch(/Mobile app \(React Native with Expo\)[\s\S]*(Native-feeling|mobile)/);
    });

    it('stays out of small fixes', () => {
        expect(referenceBlock('fix the typo in the footer')).toBe('');
    });
});
