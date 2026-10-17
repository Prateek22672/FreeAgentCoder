import { describe, expect, it } from 'vitest';
import { choosePlaybooks } from './playbooks';
import { chooseSpecialist } from './specialists';
import { isCorrection } from './correction';
import { exchangesFrom, parseUnderstanding, settleUnderstanding, understandingBlock, withInputsFrom } from './understand';

/** Requests from real chats that were misread, and what they mean. */
describe('requests that used to be misread', () => {
    const presentation = 'create a presentation on the topic busssinces model evolution of the local store to e commer suppoerred hybrid store';

    it('a presentation about a business model is a document, not a machine-learning task', () => {
        expect(choosePlaybooks(presentation, 'deep', new Set()).map((p) => p.id)).toEqual(['documents']);
        expect(chooseSpecialist(presentation)?.id).not.toBe('data');
    });

    it('still knows real machine-learning work', () => {
        expect(chooseSpecialist('train a classification model on churn.csv')?.id).toBe('data');
        expect(choosePlaybooks('build a prediction model for house prices', 'deep', new Set()).length).toBeGreaterThan(0);
    });

    it('the keyword rule still flags "here" with an attachment, which is why understanding now decides', () => {
        // Kept as a record: this rule turned "where to download here" (about Flutter) into building a download button.
        expect(isCorrection('where to download here no download button here?', true, true)).toBe(true);
    });
});

describe('understanding the request', () => {
    it('reads the model reply leniently and keeps every path the user wrote', () => {
        const reply =
            '```json\n{"request":"Install Flutter from the zip, then run the app and give the localhost link","kind":"setup","new_topic":false,"complaint":true,"previous_problem":"told me to install it myself","deliverable":"a localhost link","must_not":["tell the user to install it"],"inputs":[],"question":"","confidence":0.9}\n```';
        const message = 'C:\\Users\\Lenovo\\OneDrive\\Desktop\\py\\test\\wallpaper_app\\flutter_windows_3.47.7-stable.zip\n\ndone\nits your job now';
        const u = withInputsFrom(message, parseUnderstanding(reply)!);
        expect(u.kind).toBe('setup');
        expect(u.complaint).toBe(true);
        expect(u.inputs).toEqual(['C:\\Users\\Lenovo\\OneDrive\\Desktop\\py\\test\\wallpaper_app\\flutter_windows_3.47.7-stable.zip']);
        const block = understandingBlock(u);
        expect(block).toContain('What the user wants now: Install Flutter from the zip');
        expect(block).toContain('do the work yourself instead of telling them to');
    });

    it('a presentation is documents even when the model calls it design', () => {
        const reply = '{"request":"Create a presentation on business model evolution","kind":"design","deliverable":"A PowerPoint (.pptx) presentation","confidence":0.9}';
        expect(settleUnderstanding('create a presentation on the topic …', parseUnderstanding(reply)!).kind).toBe('documents');
        const web = '{"request":"Build web slides with reveal.js","kind":"build","deliverable":"An HTML slide deck","confidence":0.9}';
        expect(settleUnderstanding('make web slides with reveal.js', parseUnderstanding(web)!).kind).toBe('build');
    });

    it('refuses replies that are not the expected JSON', () => {
        expect(parseUnderstanding('Sure! Here is what they want...')).toBeUndefined();
        expect(parseUnderstanding('{"request":"x","kind":"dance"}')).toBeUndefined();
    });

    it('rebuilds the conversation from what the chat showed', () => {
        const ex = exchangesFrom([
            { type: 'turnStart', turnId: 'a', prompt: 'run my app' },
            { type: 'text', turnId: 'a', delta: 'Flu' },
            { type: 'assistant', turnId: 'a', content: 'Flutter is not installed.' },
            { type: 'turnStart', turnId: 'b', prompt: 'you run it' },
        ]);
        expect(ex).toEqual([
            { user: 'run my app', agent: 'Flutter is not installed.' },
            { user: 'you run it', agent: '' },
        ]);
    });
});
