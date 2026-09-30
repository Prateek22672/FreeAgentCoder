import { describe, expect, it } from 'vitest';
import { chooseSpecialist, specialistSection, SPECIALISTS } from './specialists';

const pick = (prompt: string, enabled?: string[]) => chooseSpecialist(prompt, enabled ? new Set(enabled) : undefined)?.id;

describe('choosing the method for a task', () => {
    it('treats anything broken as debugging, even when it also says "add"', () => {
        expect(pick('The login page crashes when the password is empty')).toBe('fix');
        expect(pick('Checkout returns a 500 error, please fix it')).toBe('fix');
        expect(pick('add a null check because the app crashes on startup')).toBe('fix');
    });

    it('keeps refactors apart from features, since behaviour must not change', () => {
        expect(pick('Refactor the auth module into smaller files')).toBe('refactor');
        expect(pick('clean up the utils folder')).toBe('refactor');
    });

    it('recognises interface work', () => {
        expect(pick('Make the navbar responsive on mobile')).toBe('design');
        expect(pick('the dashboard looks bad in dark mode')).toBe('design');
    });

    it('recognises data and machine learning work', () => {
        expect(pick('Train a classifier on this csv and report accuracy')).toBe('data');
        expect(pick('fine-tune the embedding model')).toBe('data');
    });

    it('recognises building something new', () => {
        expect(pick('Build a Stripe checkout for the pricing page')).toBe('build');
        expect(pick('add Google sign up')).toBe('build');
    });

    it('treats plain questions as explaining, and changes nothing', () => {
        expect(pick('How does the caching layer decide when to expire?')).toBe('explain');
        expect(pick('what does useSession return')).toBe('explain');
    });

    it('does not treat a question that asks for a change as an explanation', () => {
        expect(pick('Why is the build broken? fix it')).toBe('fix');
        expect(pick('how do I add a dark mode toggle, can you add one')).not.toBe('explain');
    });

    it('returns nothing when no method clearly applies', () => {
        expect(pick('thanks')).toBeUndefined();
        expect(pick('')).toBeUndefined();
    });

    it('skips a specialist the admin has switched off', () => {
        expect(pick('The app crashes on start', ['build', 'design'])).toBeUndefined();
        expect(pick('The app crashes on start and I need a new settings page', ['build'])).toBe('build');
    });
});

describe('the brief section', () => {
    it('numbers the method, lists the finish line, and appends the admin addition', () => {
        const text = specialistSection(SPECIALISTS[0]!, 'Always run the e2e suite too.');
        expect(text).toMatch(/^## Method: Debugging/);
        expect(text).toMatch(/1\. Reproduce it first/);
        expect(text).toMatch(/### Before you report it done/);
        expect(text).toMatch(/### Also\nAlways run the e2e suite too\./);
    });

    it('omits the addition when there is none', () => {
        expect(specialistSection(SPECIALISTS[0]!)).not.toMatch(/### Also/);
    });
});
