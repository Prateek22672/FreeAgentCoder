import { describe, expect, it } from 'vitest';
import { asksForSomethingNew, isGeneralQuestion } from './intent';

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

describe('isGeneralQuestion', () => {
    it('is true for questions about the world', () => {
        for (const q of ['what is a closure in javascript?', 'How does OAuth 2 work', 'difference between TCP and UDP', 'explain big O notation simply']) {
            expect(isGeneralQuestion(q)).toBe(true);
        }
    });

    it('is false for anything about the project, a file or the conversation', () => {
        for (const q of ['explain my project', 'what does main.ts do?', 'why is the build failing', 'how do I run this', 'why did you do that?', 'what is in src/app', 'create a todo app']) {
            expect(isGeneralQuestion(q)).toBe(false);
        }
    });
});
