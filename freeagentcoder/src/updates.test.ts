import { describe, expect, it, vi } from 'vitest';
vi.mock('vscode', () => ({}));
import { isNewer } from './updates';

describe('isNewer', () => {
    it('compares versions part by part', () => {
        expect(isNewer('0.4.1', '0.4.0')).toBe(true);
        expect(isNewer('0.10.0', '0.9.9')).toBe(true);
        expect(isNewer('0.4.0', '0.4.0')).toBe(false);
        expect(isNewer('0.3.0', '0.4.0')).toBe(false);
    });
});
