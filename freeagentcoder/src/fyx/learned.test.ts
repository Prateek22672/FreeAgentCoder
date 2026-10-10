import { describe, expect, it } from 'vitest';
import { LearnedCommands } from './learned';

function memento() {
    const store = new Map<string, unknown>();
    return { get: <T>(key: string, fallback: T) => (store.has(key) ? (store.get(key) as T) : fallback), update: async (key: string, value: unknown) => void store.set(key, value) };
}

describe('LearnedCommands', () => {
    it('lists what was learned, newest first, and forgets one', async () => {
        const learned = new LearnedCommands(memento());
        await learned.learn('run the website', 'npm run dev');
        await new Promise((r) => setTimeout(r, 2));
        await learned.learn('zip the homes folder', 'tar -a -c -f homes.zip homes');
        expect(learned.list().map((l) => l.command)).toEqual(['tar -a -c -f homes.zip homes', 'npm run dev']);
        expect(await learned.forgetKey('run the website')).toBe(true);
        expect(learned.list()).toHaveLength(1);
        expect(learned.plan('run the website')).toBeUndefined();
    });
});

describe('worthLearning', () => {
    it('learns a zip but never a forced or deleting command', async () => {
        const { worthLearning } = await import('./learned');
        expect(worthLearning('zip the homes folder', 'tar -a -c -f homes.zip homes')).toBe(true);
        expect(worthLearning('push my branch', 'git push -f origin main')).toBe(false);
        expect(worthLearning('clean the build', 'rm -rf dist')).toBe(false);
    });
});
