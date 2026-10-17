import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { windowsSwitches, type ShellInfo } from '../src/node/shell';
import { installedSdks, sdkGuard, withSdksOnPath } from '../src/node/sdks';

/** A real chat: the agent could not see the Flutter it had installed, deleted it, and unpacked 1.9 GB again for 15 minutes. */

const win = process.platform === 'win32';
let base: string;
let saved: string | undefined;

function flutterAt(root: string, complete: boolean): void {
  const dir = path.join(root, 'flutter');
  for (const part of [['bin'], ['bin', 'cache', 'dart-sdk', 'bin'], ['packages', 'flutter', 'lib'], ['packages', 'flutter_tools']]) {
    mkdirSync(path.join(dir, ...part), { recursive: true });
  }
  writeFileSync(path.join(dir, 'bin', 'cache', 'dart-sdk', 'bin', win ? 'dart.exe' : 'dart'), '');
  if (complete) {
    writeFileSync(path.join(dir, 'bin', win ? 'flutter.bat' : 'flutter'), '');
    writeFileSync(path.join(dir, 'packages', 'flutter', 'lib', 'material.dart'), '');
    writeFileSync(path.join(dir, 'packages', 'flutter_tools', 'pubspec.yaml'), '');
  }
}

beforeAll(() => {
  base = mkdtempSync(path.join(tmpdir(), 'fac-sdk-'));
  saved = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = base;
});
afterAll(() => {
  process.env.LOCALAPPDATA = saved;
  rmSync(base, { recursive: true, force: true });
});

describe('toolchains FreeAgentCoder installed', () => {
  it('tells a half-finished unpack from a complete one (the Dart SDK comes early in the zip)', () => {
    const partial = mkdtempSync(path.join(base, 'p-'));
    flutterAt(partial, false);
    expect(installedSdks(partial)).toEqual([expect.objectContaining({ name: 'flutter', complete: false })]);
    const whole = mkdtempSync(path.join(base, 'w-'));
    flutterAt(whole, true);
    expect(installedSdks(whole)[0]?.complete).toBe(true);
  });

  it.runIf(win)('puts a complete one first on PATH for every command, and protects it', () => {
    flutterAt(path.join(base, 'FreeAgentCoder', 'sdk'), true);
    const env = withSdksOnPath({ Path: 'C:\\Windows' });
    expect(env.Path).toBe(`${path.join(base, 'FreeAgentCoder', 'sdk', 'flutter', 'bin')};C:\\Windows`);
    expect(Object.keys(env).filter((k) => k.toUpperCase() === 'PATH')).toEqual(['Path']);

    expect(sdkGuard('MSYS_NO_PATHCONV=1 cmd //c "rmdir /S /Q \\"C:\\Users\\Lenovo\\AppData\\Local\\FreeAgentCoder\\sdk\\""')).toMatch(/already installed and complete/);
    expect(sdkGuard("python - <<'PY'\nimport shutil\nshutil.rmtree('C:/Users/Lenovo/AppData/Local/FreeAgentCoder/sdk')\nPY")).toMatch(/Do not delete or unpack it again/);
    expect(sdkGuard('powershell -Command "Expand-Archive -Path x.zip -DestinationPath C:\\Users\\Lenovo\\AppData\\Local\\FreeAgentCoder\\sdk -Force"')).toMatch(/flutter --version/);
    expect(sdkGuard('flutter --version')).toBeUndefined();
    expect(sdkGuard('ls C:/Users/Lenovo/AppData/Local/FreeAgentCoder/sdk/flutter/bin')).toBeUndefined();
  });
});

describe('unpacking a zip in Git Bash', () => {
  const bash: ShellInfo = { kind: 'bash', path: 'bash', label: 'Git Bash' };
  it('uses Windows tar.exe, which reads zip files (GNU tar said "This does not look like a tar archive")', () => {
    expect(windowsSwitches(bash, 'tar -xf /c/Users/x/flutter_windows.zip -C /c/sdk', 'win32')).toBe('C:/Windows/System32/tar.exe -xf /c/Users/x/flutter_windows.zip -C /c/sdk');
    expect(windowsSwitches(bash, 'tar -xzf app.tar.gz', 'win32')).toBe('tar -xzf app.tar.gz');
  });
});
