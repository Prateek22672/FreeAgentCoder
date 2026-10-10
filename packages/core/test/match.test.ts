import { describe, expect, it } from 'vitest';
import { bestMatches, matchScore, MATCH_THRESHOLD } from '../src/util/match';

describe('matchScore', () => {
  it('counts whole phrases and shared words, ignoring words every request has', () => {
    expect(matchScore('build a CRM with role based access control in ASP.NET', ['role based access control', 'crm', 'asp.net'])).toBeGreaterThanOrEqual(7);
    expect(matchScore('build a new web app', ['app', 'web', 'build'])).toBe(0);
  });

  it('keeps only items over the threshold, best first', () => {
    const items = [
      { name: 'Parking dashboard', tags: ['smart parking', 'dark mode', 'realtime dashboard'] },
      { name: 'Coffee shop', tags: ['cafe', 'menu', 'coffee'] },
    ];
    expect(bestMatches(items, 'a dark smart parking dashboard', (i) => i, 2).map((i) => i.name)).toEqual(['Parking dashboard']);
    expect(bestMatches(items, 'fix a typo', (i) => i, 2)).toEqual([]);
    expect(MATCH_THRESHOLD).toBe(3);
  });
});
