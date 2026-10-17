import { exec } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import type { Tool } from '../tools/types';
import { installedSdks, sdkRoot, withSdksOnPath } from './sdks';

export interface ToolchainCheck {
  id: string;
  label: string;
  command: string;
  timeoutMs?: number;
}

export const TOOLCHAINS: ToolchainCheck[] = [
  { id: 'node', label: 'Node.js', command: 'node --version' },
  { id: 'npm', label: 'npm', command: 'npm --version' },
  { id: 'pnpm', label: 'pnpm', command: 'pnpm --version' },
  { id: 'yarn', label: 'Yarn', command: 'yarn --version' },
  { id: 'bun', label: 'Bun', command: 'bun --version' },
  { id: 'python', label: 'Python', command: process.platform === 'win32' ? 'python --version' : 'python3 --version' },
  { id: 'uv', label: 'uv', command: 'uv --version' },
  { id: 'poetry', label: 'Poetry', command: 'poetry --version' },
  { id: 'conda', label: 'Conda', command: 'conda --version' },
  { id: 'java', label: 'Java', command: 'java -version' },
  { id: 'flutter', label: 'Flutter', command: 'flutter --version', timeoutMs: 45_000 },
  { id: 'dart', label: 'Dart', command: 'dart --version', timeoutMs: 20_000 },
  { id: 'go', label: 'Go', command: 'go version' },
  { id: 'rust', label: 'Rust (cargo)', command: 'cargo --version' },
  { id: 'dotnet', label: '.NET', command: 'dotnet --version' },
  { id: 'docker', label: 'Docker', command: 'docker --version' },
  { id: 'git', label: 'Git', command: 'git --version' },
  { id: 'adb', label: 'Android platform tools (adb)', command: 'adb version' },
];

export type CommandRunner = (command: string, timeoutMs: number) => Promise<{ ok: boolean; output: string }>;

const runVersionCommand: CommandRunner = (command, timeoutMs) =>
  new Promise((resolve) => {
    exec(command, { timeout: timeoutMs, windowsHide: true, env: withSdksOnPath({ ...process.env }) }, (error, stdout, stderr) => {
      resolve({ ok: !error, output: `${stdout}\n${stderr}`.trim() });
    });
  });

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  return line.trim().slice(0, 120);
}

function androidSdk(): string | undefined {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.platform === 'win32' && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : undefined,
    process.platform === 'darwin' && home ? path.join(home, 'Library', 'Android', 'sdk') : undefined,
    process.platform === 'linux' && home ? path.join(home, 'Android', 'Sdk') : undefined,
  ];
  return candidates.find((dir): dir is string => !!dir && existsSync(dir));
}

function androidPlatforms(sdk: string): string {
  try {
    return readdirSync(path.join(sdk, 'platforms'))
      .filter((name) => name.startsWith('android-'))
      .join(', ');
  } catch {
    return '';
  }
}

/**
 * Which toolchains are installed, found by running each one's version
 * command in parallel. Much faster and safer than searching the disk.
 */
/** The installed toolchain that provides a tool (Flutter brings Dart). */
function fromSdk(id: string) {
  const owner = id === 'dart' ? 'flutter' : id;
  return installedSdks().find((s) => s.complete && s.name.toLowerCase() === owner);
}

export async function inspectEnvironment(
  only?: string[],
  runner: CommandRunner = runVersionCommand,
): Promise<{ text: string; found: string[]; missing: string[] }> {
  const requested = (only ?? []).map((id) => id.toLowerCase().trim()).filter(Boolean);
  const wanted = requested.length ? TOOLCHAINS.filter((t) => requested.includes(t.id)) : TOOLCHAINS;
  const results = await Promise.all(wanted.map(async (tool) => ({ tool, ...(await runner(tool.command, tool.timeoutMs ?? 10_000)) })));

  const lines: string[] = [];
  const found: string[] = [];
  const missing: string[] = [];
  for (const { tool, ok, output } of results) {
    const version = firstLine(output);
    if (ok && version) {
      found.push(tool.id);
      lines.push(`✓ ${tool.label}: ${version}`);
    } else if (fromSdk(tool.id)) {
      // Installed and complete but still building itself on its first run (Flutter takes about a minute): it is there.
      found.push(tool.id);
      lines.push(`✓ ${tool.label}: installed by FreeAgentCoder in ${fromSdk(tool.id)!.dir} (on PATH; its first run prepares for about a minute, so run it once with background=true)`);
    } else {
      missing.push(tool.id);
      lines.push(`✗ ${tool.label}: not found`);
    }
  }

  if (!requested.length || requested.some((id) => id.startsWith('android'))) {
    const sdk = androidSdk();
    if (sdk) {
      found.push('android');
      const platforms = androidPlatforms(sdk);
      lines.push(`✓ Android SDK: ${sdk}${platforms ? ` (${platforms})` : ''}`);
    } else {
      missing.push('android');
      lines.push('✗ Android SDK: not found (install Android Studio, or set ANDROID_HOME)');
    }
  }

  for (const id of requested) {
    if (!id.startsWith('android') && !TOOLCHAINS.some((t) => t.id === id)) {
      lines.push(`? ${id}: not a known toolchain; check it with run_command`);
    }
  }

  const installed = installedSdks().filter((s) => s.complete);
  if (installed.length) {
    lines.push('', `Installed by FreeAgentCoder in ${sdkRoot()} and on PATH for your commands: ${installed.map((s) => s.name).join(', ')}. Use them directly; never install or unpack them again.`);
  }
  lines.push(
    '',
    `If a required tool is missing: look for an installer or archive the user gave (in their message or the project folder) and install it into ${sdkRoot()}, in the background; it is then on PATH for your commands. Otherwise tell the user the one thing to install, with the official page. Ask before system package managers or changing PATH or shell profiles.`,
  );
  return { text: `Toolchains (${process.platform}):\n${lines.join('\n')}`, found, missing };
}

export const environmentTool: Tool<{ tools?: string[] }> = {
  name: 'inspect_environment',
  description:
    'Check which developer toolchains are installed, with versions (Node, Python, Java, Flutter, Go, Rust, .NET, Docker, Git, Android SDK and more), in one call. Use it before building a project instead of searching the disk.',
  parameters: {
    type: 'object',
    properties: {
      tools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Only check these ids, e.g. ["flutter","java","android"]. Default: all.',
      },
    },
  },
  kind: 'read',
  label: (args) => (args.tools?.length ? `Check ${args.tools.join(', ')}` : 'Check installed toolchains'),
  async prepare(args) {
    return {
      run: async () => {
        const result = await inspectEnvironment(args.tools);
        return { content: result.text, summary: `${result.found.length} found, ${result.missing.length} missing` };
      },
    };
  },
};
