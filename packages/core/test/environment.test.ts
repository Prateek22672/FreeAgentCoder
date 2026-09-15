import { describe, expect, it } from 'vitest';
import { inspectEnvironment } from '../src/node/environment';

describe('inspectEnvironment', () => {
  it('reports found and missing toolchains with their version line', async () => {
    const runner = async (command: string) => {
      if (command.startsWith('node')) return { ok: true, output: 'v22.14.0\n' };
      if (command.startsWith('java')) return { ok: true, output: 'openjdk version "17.0.14" 2025-01-21\nOpenJDK Runtime' };
      return { ok: false, output: "'flutter' is not recognized as an internal or external command" };
    };
    const result = await inspectEnvironment(['node', 'java', 'flutter'], runner);

    expect(result.found).toEqual(['node', 'java']);
    expect(result.missing).toEqual(['flutter']);
    expect(result.text).toContain('✓ Node.js: v22.14.0');
    expect(result.text).toContain('✓ Java: openjdk version "17.0.14" 2025-01-21');
    expect(result.text).toContain('✗ Flutter: not found');
    expect(result.text).toContain('Ask before installing SDKs');
  });

  it('treats a command with no output as missing and flags unknown tool ids', async () => {
    const result = await inspectEnvironment(['git', 'xcode'], async () => ({ ok: true, output: '' }));
    expect(result.missing).toEqual(['git']);
    expect(result.text).toContain('? xcode: not a known toolchain');
  });
});
