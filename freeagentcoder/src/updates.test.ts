import { describe, expect, it, vi } from 'vitest';
vi.mock('vscode', () => ({}));
import { installKind, isNewer } from './updates';

describe('installKind', () => {
    it('is new on the first install and on a reinstall of the same version', () => {
        expect(installKind(1_000, undefined, '0.4.2', undefined)).toBe('new');
        expect(installKind(2_000, 1_000, '0.4.2', '0.4.2')).toBe('new');
    });

    it('is an update when the version changed, and nothing when it is the same install', () => {
        expect(installKind(2_000, 1_000, '0.4.2', '0.4.1')).toBe('update');
        expect(installKind(1_000, 1_000, '0.4.2', '0.4.2')).toBe('same');
        expect(installKind(1_000, 1_000, '0.4.2', '0.4.1')).toBe('same');
    });
});

describe('isNewer', () => {
    it('compares versions part by part', () => {
        expect(isNewer('0.4.1', '0.4.0')).toBe(true);
        expect(isNewer('0.10.0', '0.9.9')).toBe(true);
        expect(isNewer('0.4.0', '0.4.0')).toBe(false);
        expect(isNewer('0.3.0', '0.4.0')).toBe(false);
    });
});
