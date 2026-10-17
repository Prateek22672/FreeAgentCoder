import { existsSync, readdirSync, statSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Toolchains FreeAgentCoder installed from a file the user supplied (a Flutter
 * zip): one folder, outside OneDrive and projects, put first on PATH for every
 * command the agent runs. In a real chat the agent could not see the Flutter it
 * had installed the day before (not on PATH, "0 found"), unpacked the 1.9 GB
 * zip again with a tar that cannot read zips, deleted the working copy, and
 * spent 15 minutes re-extracting it.
 */

export function sdkRoot(): string {
  return process.platform === 'win32' && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'FreeAgentCoder', 'sdk')
    : path.join(os.homedir(), '.freeagentcoder', 'sdk');
}

export interface InstalledSdk {
  name: string;
  dir: string;
  bin: string;
  /** Everything it needs is there (Flutter: its bundled Dart SDK), not a half-finished unpack. */
  complete: boolean;
}

/**
 * Files only a fully unpacked Flutter has: an unpack cut short had the Dart SDK
 * (early in the zip) but not flutter.bat or the framework.
 */
const win = process.platform === 'win32';
const FLUTTER_PARTS = [
  ['bin', win ? 'flutter.bat' : 'flutter'],
  ['bin', 'cache', 'dart-sdk', 'bin', win ? 'dart.exe' : 'dart'],
  ['packages', 'flutter', 'lib', 'material.dart'],
  ['packages', 'flutter_tools', 'pubspec.yaml'],
];

export function installedSdks(root = sdkRoot()): InstalledSdk[] {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const dir = path.join(root, name);
    const bin = path.join(dir, 'bin');
    if (!existsSync(bin)) return [];
    return [{ name, dir, bin, complete: name.toLowerCase() !== 'flutter' || FLUTTER_PARTS.every((part) => existsSync(path.join(dir, ...part))) }];
  });
}

/** The environment with the installed toolchains first on PATH (whatever case the PATH key has on Windows). */
export function withSdksOnPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const bins = installedSdks()
    .filter((s) => s.complete)
    .map((s) => s.bin);
  if (!bins.length) return env;
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const parts = (env[key] ?? '').split(path.delimiter).filter(Boolean);
  return { ...env, [key]: [...bins.filter((b) => !parts.includes(b)), ...parts].join(path.delimiter) };
}

const DELETES = /\b(?:rm\s+-[a-z]*r|rmdir|rd\s+\/s|Remove-Item\b[^;|&]*-Recurse|shutil\.rmtree|del\s+\/[sq])/i;
const EXTRACTS = /\b(?:Expand-Archive|tar(?:\.exe)?["']?\s+-?[a-z]*x|unzip\s|7z\s+x|zipfile|extractall)/i;
const IN_SDK_ROOT = /freeagentcoder[\\/]+sdk/i;

/** Refuses deleting or unpacking over a toolchain that is installed and complete. */
export function sdkGuard(command: string): string | undefined {
  if (!IN_SDK_ROOT.test(command) || !(DELETES.test(command) || EXTRACTS.test(command))) return undefined;
  const ready = installedSdks().filter((s) => s.complete);
  if (!ready.length) return undefined;
  const names = ready.map((s) => s.name).join(', ');
  return (
    `Not run: ${names} ${ready.length === 1 ? 'is' : 'are'} already installed and complete in ${sdkRoot()}, and on PATH for your commands. ` +
    `Do not delete or unpack it again: run ${ready[0]!.name} --version to see it work, then carry on with the task.`
  );
}

const ARCHIVE = /["']?((?:[A-Za-z]:|\/[a-z]\/|\.{0,2}\/)?[^\s"'|;&]*\.(?:zip|tar\.gz|tgz|tar\.xz|7z))["']?/gi;

/** An extraction of an archive over 100 MB: minutes of work, so it runs in the background. */
export function extractsBigArchive(command: string, cwd: string): boolean {
  if (!EXTRACTS.test(command)) return false;
  for (const [, raw] of command.matchAll(ARCHIVE)) {
    const file = raw!.replace(/^\/([a-z])\//i, '$1:/');
    try {
      if (statSync(path.resolve(cwd, file)).size > 100_000_000) return true;
    } catch {
      // not a file here
    }
  }
  return false;
}
