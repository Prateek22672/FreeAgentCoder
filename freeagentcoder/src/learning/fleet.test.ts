import { describe, expect, it } from 'vitest';
import { chorePattern, emptyQueue, enqueue, isShareableRule, queueSize } from './fleet';

describe('fleet learning on this machine', () => {
    it('shares chores as patterns with every name replaced', () => {
        expect(chorePattern('zip the homes folder', 'tar -a -c -f homes.zip homes')).toEqual({ pattern: 'zip the {name} folder', command: 'tar -a -c -f {name}.zip {name}' });
        expect(chorePattern('push to dev', 'git push origin dev')).toEqual({ pattern: 'push to {name}', command: 'git push origin {name}' });
        // A path stays in the command, so it is not shared at all.
        expect(chorePattern('zip my stuff', 'tar -a -c -f out.zip C:/Users/ravi/stuff')).toBeUndefined();
    });

    it('keeps rules about one project on this machine', () => {
        expect(isShareableRule('python-pptx takes RGBColor values from 0 to 255; matplotlib takes hex strings.')).toBe(true);
        expect(isShareableRule('Our API lives in src/server/routes/users.ts')).toBe(false);
    });

    it('keeps the queue bounded, newest first kept', () => {
        let q = emptyQueue();
        for (let i = 0; i < 60; i++) {
            q = enqueue(q, 'feedback', [{ kind: 'build', provider: 'gemini', model: 'm', good: i % 2 === 0, reasons: [] }]);
        }
        expect(q.feedback).toHaveLength(50);
        expect(queueSize(q)).toBe(50);
    });
});
