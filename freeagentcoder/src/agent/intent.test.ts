import { describe, expect, it } from 'vitest';
import { asksForSomethingNew } from './intent';

describe('asksForSomethingNew', () => {
    it('is true for requests to make something new', () => {
        expect(asksForSomethingNew('i need a small ppt for presenting this, 12 slides on Nepal floods 2026, a pdf')).toBe(true);
        expect(asksForSomethingNew('Create a simple GenAI project called AI Student Chatbot')).toBe(true);
    });

    it('is false for changes to what is there', () => {
        expect(asksForSomethingNew('fix the login bug in auth.ts')).toBe(false);
        expect(asksForSomethingNew('create a test for my project')).toBe(false);
        expect(asksForSomethingNew('why is the build slow')).toBe(false);
    });
});
