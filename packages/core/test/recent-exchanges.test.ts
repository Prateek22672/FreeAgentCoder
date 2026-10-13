import { describe, expect, it } from 'vitest';
import { recentExchanges } from '../src/agent/agent';
import type { Message } from '../src/types';

const u = (content: string): Message => ({ role: 'user', content });
const a = (content: string): Message => ({ role: 'assistant', content }) as Message;
const t = (content: string): Message => ({ role: 'tool', toolCallId: 'x', name: 'read_file', content }) as Message;

describe('recentExchanges', () => {
  const history = [u('build a site'), a('calling a tool'), t('file contents'), a('done'), u('thanks'), a('welcome'), u('hi')];

  it('keeps the current request and the exchanges before it, starting at a user message', () => {
    expect(recentExchanges(history, 1)).toEqual([u('thanks'), a('welcome'), u('hi')]);
    expect(recentExchanges(history, 0)).toEqual([u('hi')]);
  });

  it('keeps everything when the history is shorter than asked', () => {
    expect(recentExchanges(history, 5)).toEqual(history);
  });
});
