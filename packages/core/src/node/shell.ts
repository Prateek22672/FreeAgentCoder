import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import * as path from 'node:path';
import { toolError, type Tool, type ToolContext, type ToolResult } from '../tools/types';
import { extractsBigArchive, sdkGuard, withSdksOnPath } from './sdks';
import { collapseCarriageReturns, stripAnsi, truncateMiddle } from '../util/text';

export interface ShellInfo {
  kind: 'bash' | 'powershell' | 'sh' | 'cmd';
  path: string;
  label: string;
}

/**
 * Models know bash far better than PowerShell, so on Windows we use Git Bash
 * when it's installed and fall back to PowerShell otherwise. The system
 * prompt tells the model which one it has.
 */
export function detectShell(preferred?: string): ShellInfo {
  if (preferred) {
    const lower = preferred.toLowerCase();
    if (lower.includes('powershell') || lower.includes('pwsh')) return { kind: 'powershell', path: preferred, label: 'PowerShell' };
    if (lower.endsWith('cmd.exe') || lower === 'cmd') return { kind: 'cmd', path: preferred, label: 'cmd.exe' };
    return { kind: 'bash', path: preferred, label: path.basename(preferred) };
  }
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'bin', 'bash.exe'),
    ];
    for (const candidate of candidates) if (existsSync(candidate)) return { kind: 'bash', path: candidate, label: 'Git Bash' };
    return { kind: 'powershell', path: 'powershell.exe', label: 'Windows PowerShell' };
  }
  const envShell = process.env.SHELL;
  if (envShell && /(bash|zsh)$/.test(envShell)) return { kind: 'bash', path: envShell, label: path.basename(envShell) };
  if (existsSync('/bin/bash')) return { kind: 'bash', path: '/bin/bash', label: 'bash' };
  return { kind: 'sh', path: '/bin/sh', label: 'sh' };
}

function shellArgs(shell: ShellInfo, command: string): string[] {
  switch (shell.kind) {
    case 'powershell':
      return [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; ${command}`,
      ];
    case 'cmd':
      return ['/d', '/s', '/c', command];
    default:
      return ['-c', command];
  }
}

/** Environment for agent commands: no pagers, no prompts, no color codes. */
function commandEnv(): NodeJS.ProcessEnv {
  return withSdksOnPath({
    ...process.env,
    PAGER: 'cat',
    GIT_PAGER: 'cat',
    GIT_TERMINAL_PROMPT: '0',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    npm_config_yes: 'true',
    PYTHONUNBUFFERED: '1',
    // Windows consoles default Python to cp1252, so printing "→" or an emoji crashes the script.
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  });
}

function spawnShell(shell: ShellInfo, command: string, cwd: string): ChildProcess {
  return spawn(shell.path, shellArgs(shell, command), {
    cwd,
    env: commandEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    // Own process group on POSIX so the whole tree can be killed.
    detached: process.platform !== 'win32',
  });
}

export function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  const pid = child.pid;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }, 2000).unref();
}

function cleanOutput(raw: string): string {
  return collapseCarriageReturns(stripAnsi(raw)).trim();
}

// ---------------------------------------------------------------- background

interface BackgroundProcess {
  id: string;
  command: string;
  child: ChildProcess;
  output: string;
  readUpTo: number;
  exitCode: number | null;
  exited: boolean;
  startedAt: number;
}

/** Starts of the same app allowed in one task; after that the agent reports instead of guessing again. */
export const MAX_STARTS = 3;

/** Long-running processes (dev servers, watchers) the agent started. */
export class ProcessRegistry {
  private procs = new Map<string, BackgroundProcess>();
  private counter = 0;
  private starts = new Map<string, number>();

  /** A new task: start counts begin again. */
  newTask(): void {
    this.starts.clear();
  }

  /** Counts a start of this app in the current task and returns how many there have been. */
  countStart(command: string): number {
    const key = appKey(command);
    const n = (this.starts.get(key) ?? 0) + 1;
    this.starts.set(key, n);
    return n;
  }

  start(shell: ShellInfo, command: string, cwd: string): BackgroundProcess {
    const child = spawnShell(shell, command, cwd);
    const proc: BackgroundProcess = {
      id: `p${++this.counter}`,
      command,
      child,
      output: '',
      readUpTo: 0,
      exitCode: null,
      exited: false,
      startedAt: Date.now(),
    };
    const onData = (buf: Buffer) => {
      proc.output += buf.toString('utf8');
      if (proc.output.length > 400_000) {
        const drop = proc.output.length - 200_000;
        proc.output = proc.output.slice(drop);
        proc.readUpTo = Math.max(0, proc.readUpTo - drop);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('close', (code) => {
      proc.exited = true;
      proc.exitCode = code;
    });
    child.on('error', (err) => {
      proc.output += `\n[failed to start: ${err.message}]`;
      proc.exited = true;
    });
    this.procs.set(proc.id, proc);
    return proc;
  }

  get(id: string): BackgroundProcess | undefined {
    return this.procs.get(id);
  }

  list(): BackgroundProcess[] {
    return [...this.procs.values()];
  }

  stop(id: string): boolean {
    const proc = this.procs.get(id);
    if (!proc) return false;
    killTree(proc.child);
    return true;
  }

  killAll(): void {
    for (const proc of this.procs.values()) if (!proc.exited) killTree(proc.child);
  }
}

/**
 * Commands that start a server or watcher and never exit by themselves. Run in
 * the foreground they are killed at the time-out just as they come up (a real
 * Flutter build took 96 s, then was stopped at 120 s), so they always run in
 * the background.
 */
const LONG_RUNNING =
  /\bflutter(?:\.bat)?["']?\s+run\b|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview|watch)\b|\bvite(?:\s+(?:dev|preview|--)|\s*$)|\bnext\s+(?:dev|start)\b|\bng\s+serve\b|\bpython3?\s+-m\s+http\.server\b|\buvicorn\s|\bflask\s+run\b|manage\.py\s+runserver\b|\bphp\s+-S\b|\bdotnet\s+watch\b|\b(?:http-server|live-server|nodemon)\b/i;

export function isLongRunning(command: string): boolean {
  return LONG_RUNNING.test(command);
}

/** The app a command starts ("flutter run", "npm run", "python http.server"), whatever its ports and flags. */
export function appKey(command: string): string {
  const last = command.split(/&&|\|\||;/).pop() ?? command;
  const words = last.trim().replace(/^(?:\w+=\S*\s+)*/, '').split(/\s+/).map((w) => w.replace(/^["']|["']$/g, ''));
  const program = (words[0] ?? '').split(/[\\/]/).pop()!.replace(/\.(?:bat|cmd|exe)$/i, '').toLowerCase();
  const sub = words.slice(1).find((w) => w && !w.startsWith('-')) ?? '';
  return `${program} ${sub.toLowerCase()}`.trim();
}

/** The port a command asks a server to listen on, when it names one. */
export function portIn(command: string): number | undefined {
  const m = /(?:--(?:web-)?port[=\s]+|--server\.port[=\s]+|\s-p\s+|\bPORT=|\bhttp\.server\s+|--listen[=\s]+(?:[\w.]+:)?)(\d{2,5})\b/i.exec(command);
  const port = m ? Number(m[1]) : NaN;
  return port > 0 && port < 65_536 ? port : undefined;
}

function listenable(port: number, host: string): Promise<boolean | undefined> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (err: NodeJS.ErrnoException) => resolve(err.code === 'EADDRINUSE' || err.code === 'EACCES' ? false : undefined));
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

/** Whether something already listens on the port, on IPv4 or IPv6 (a server bound to localhost may hold only [::1]). */
export async function portBusy(port: number): Promise<boolean> {
  const results = await Promise.all(['127.0.0.1', '::1'].map((host) => listenable(port, host)));
  return results.some((free) => free === false);
}

export async function freePort(after: number): Promise<number | undefined> {
  for (let port = after + 1; port <= after + 30 && port < 65_536; port++) {
    if (!(await portBusy(port))) return port;
  }
  return undefined;
}

/** Why a background start should not happen, checked before anything runs; undefined when it may. */
export async function startProblem(registry: ProcessRegistry, command: string): Promise<string | undefined> {
  const port = portIn(command);
  if (port && (await portBusy(port))) {
    const owner = registry.list().find((p) => !p.exited && portIn(p.command) === port);
    if (owner) {
      return `Not started: port ${port} is already used by ${owner.id}, which you started (${owner.command}). Read its output with the process tool (it may already be serving), or stop it with the process tool before starting again.`;
    }
    const free = await freePort(port);
    return `Not started: port ${port} is already in use by another program on this computer. Do not stop a program you did not start; use port ${free ?? port + 1} instead${free ? ' (it is free)' : ''}.`;
  }
  const starts = registry.countStart(command);
  if (starts > MAX_STARTS) {
    return `Not started: "${appKey(command)}" has been started ${starts - 1} times in this task and has not worked. Stop here and tell the user plainly: the exact error from the last start, which files you changed and why, and what you would try next. Do not start it again.`;
  }
  return undefined;
}

// ---------------------------------------------------------------- mistakes

const KNOWN_VARS = /^(?:USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|TEMP|TMP|HOMEDRIVE|HOMEPATH|SYSTEMROOT|WINDIR|PATH|USERNAME|COMPUTERNAME|ONEDRIVE|PUBLIC|ALLUSERSPROFILE)$/i;
const CMD_VAR = /%([A-Za-z_][A-Za-z0-9_()]{2,})%/g;
/** The command hands its text to cmd or PowerShell, where their own variable syntax works. */
const OTHER_SHELL = /\b(?:cmd(?:\.exe)?\s+[/]{1,2}[ck]|powershell(?:\.exe)?|pwsh(?:\.exe)?)\b/i;

/**
 * A variable written for another shell, which this one passes through literally.
 * Git Bash leaves %USERPROFILE% as it is, so `mkdir %USERPROFILE%\sdk` makes a
 * folder named "%USERPROFILE%" in the project (a real chat filled 5.9 GB that
 * way); PowerShell does the same. Refused with the right spelling, before anything runs.
 */
export function shellMistake(shell: ShellInfo, command: string): string | undefined {
  if ((shell.kind === 'bash' || shell.kind === 'sh') && /\b(?:powershell|pwsh)(?:\.exe)?\b/i.test(command)) {
    // Inside double quotes bash expands $env:X, $_ and $(...) before PowerShell sees them ($_ became /usr/bin/bash).
    const quoted = command.replace(/'[^']*'/g, "''");
    const hit = /"[^"]*(?<!\\)\$(?:env:|_(?!\w)|[A-Za-z_]\w*|\(|\{)[^"]*"/.exec(quoted);
    if (hit) {
      return `Not run: ${shell.label} expands $ variables inside double quotes before PowerShell sees them ($env:NAME becomes empty and $_ becomes a path). Put the PowerShell code in single quotes ('…'), or save it as a .ps1 file and run powershell -NoProfile -File file.ps1.`;
    }
  }
  if (OTHER_SHELL.test(command)) return undefined;
  if (shell.kind === 'bash' || shell.kind === 'sh' || shell.kind === 'powershell') {
    for (const [, name] of command.matchAll(CMD_VAR)) {
      const value = Object.entries(process.env).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
      if (!KNOWN_VARS.test(name) && value === undefined) continue;
      const spelling = shell.kind === 'powershell' ? `$env:${name}` : `"$${name}"`;
      return (
        `Not run: ${shell.label} does not expand %${name}%, so it would be used as a literal folder name. ` +
        `Write ${spelling}${value ? ` or the full path (${value})` : ''} instead.`
      );
    }
  }
  if (shell.kind === 'bash' || shell.kind === 'sh') {
    const ps = /\$env:([A-Za-z_][A-Za-z0-9_]*)/.exec(command);
    if (ps) {
      const value = process.env[ps[1]];
      return `Not run: $env:${ps[1]} is PowerShell; in ${shell.label} write "$${ps[1]}"${value ? ` or the full path (${value})` : ''}.`;
    }
  }
  return undefined;
}

/** Windows programs whose switches look like paths to Git Bash (/c, /PID, /F). */
const SWITCH_PROGRAMS = new Set(['cmd', 'taskkill', 'tasklist', 'findstr', 'reg', 'sc', 'net', 'schtasks', 'where', 'ping', 'xcopy', 'robocopy', 'icacls', 'wmic', 'netsh', 'attrib', 'explorer', 'start']);
const SWITCH_ARG = /\s\/[A-Za-z?](?=[\s:"']|$)/;

/**
 * Git Bash rewrites an argument like /c or /PID into a Windows path ("C:/Program Files/Git/PID"), so
 * `cmd.exe /c "..."` printed only the banner and ran nothing, and `taskkill /PID 123 /F` failed. A command
 * that calls such a program with slash switches runs with path conversion off; other commands are unchanged,
 * since /c/Users/... style paths still need the conversion.
 */
export function windowsSwitches(shell: ShellInfo, command: string, platform: string = process.platform): string {
  if (platform !== 'win32' || (shell.kind !== 'bash' && shell.kind !== 'sh')) return command;
  return command
    .split(/(&&|\|\||;|\|)/)
    .map((segment, i) => {
      if (i % 2 === 1) return segment;
      const body = segment.replace(/^\s*(?:\w+=\S*\s+)*/, '');
      if (/MSYS2?_(?:NO_PATHCONV|ARG_CONV_EXCL)/.test(segment)) return segment;
      const program = /^["']?([^\s"']+)/.exec(body)?.[1];
      const name = program?.split(/[\\/]/).pop()?.replace(/\.exe$/i, '').toLowerCase();
      if (program === 'tar' && /\.zip\b/i.test(body)) {
        const lead = segment.slice(0, segment.length - body.length);
        return `${lead}C:/Windows/System32/tar.exe${body.slice(3)}`;
      }
      if (!name || !SWITCH_PROGRAMS.has(name) || !SWITCH_ARG.test(` ${body}`)) return segment;
      const lead = /^\s*/.exec(segment)![0];
      return `${lead}MSYS_NO_PATHCONV=1 ${segment.slice(lead.length)}`;
    })
    .join('');
}

/** The address a dev server printed, so the agent opens and reports the real one instead of guessing. */
export function serverAddress(output: string): string | undefined {
  const match = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d+)?(?:\/[^\s'"`<>]*)?/i.exec(stripAnsi(output));
  return match?.[0].replace(/0\.0\.0\.0/, 'localhost').replace(/[.,;)\]]+$/, '');
}

// ---------------------------------------------------------------- tools

interface RunArgs {
  command: string;
  timeout?: number;
  background?: boolean;
}

function runForeground(shell: ShellInfo, command: string, cwd: string, timeoutSec: number, ctx: ToolContext): Promise<ToolResult> {
  const timeoutMs = Math.min(600, Math.max(1, timeoutSec)) * 1000;
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnShell(shell, command, cwd);
    } catch (err) {
      resolve(toolError(`Could not start ${shell.label}: ${(err as Error).message}`));
      return;
    }
    let output = '';
    const onData = (buf: Buffer) => {
      const text = buf.toString('utf8');
      output += text;
      if (output.length > 2_000_000) output = output.slice(-1_000_000);
      ctx.onOutput?.(text);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    let timedOut = false;
    let interrupted = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    const onAbort = () => {
      interrupted = true;
      killTree(child);
    };
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    let settled = false;
    const settle = (result: ToolResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ctx.signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    child.on('error', (err) => settle(toolError(`Could not start ${shell.label}: ${err.message}`)));
    child.on('close', (code, sig) => {
      const clean = cleanOutput(output);
      const status = timedOut
        ? `Timed out after ${timeoutMs / 1000}s and was stopped; anything it wrote may be incomplete. Run servers, watchers and long installs, downloads, extractions or builds with background=true, then check them with the process tool instead of running them again.`
        : interrupted
          ? 'Stopped: the user interrupted.'
          : `Exit code: ${code ?? sig}`;
      settle({
        content: `${status}\n${truncateMiddle(clean, 8_000, 0.25) || '(no output)'}`,
        isError: timedOut || interrupted || code !== 0,
        summary: timedOut ? 'timed out' : interrupted ? 'interrupted' : `exit ${code ?? sig}`,
        display: { type: 'command', command, output: clean.slice(-4000), exitCode: code, timedOut },
      });
    });
  });
}

async function runBackground(
  registry: ProcessRegistry,
  shell: ShellInfo,
  command: string,
  cwd: string,
  signal: AbortSignal,
): Promise<ToolResult> {
  const problem = await startProblem(registry, command);
  if (problem) return toolError(problem);
  const proc = registry.start(shell, command, cwd);
  const ready = /localhost:\d+|127\.0\.0\.1:\d+|0\.0\.0\.0:\d+|ready in|listening (on|at)|compiled successfully|started server|server running|is being served at|running on http/i;
  for (let waited = 0; waited < 8000 && !proc.exited && !signal.aborted; waited += 250) {
    if (ready.test(proc.output)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.readUpTo = proc.output.length;
  const out = truncateMiddle(cleanOutput(proc.output), 4000, 0.3) || '(no output yet)';
  const state = proc.exited
    ? `It already exited with code ${proc.exitCode}.`
    : 'It is still running. Use the process tool to read more output or stop it.';
  const address = serverAddress(proc.output);
  return {
    content: `Started background process ${proc.id}: ${command}\n${state}${address ? `\nIt is serving at ${address}` : ''}\nOutput so far:\n${out}`,
    isError: proc.exited && proc.exitCode !== 0,
    summary: proc.exited ? `exited ${proc.exitCode}` : `running as ${proc.id}`,
    display: { type: 'command', command, output: out, exitCode: proc.exited ? proc.exitCode : null, background: true },
  };
}

export function runCommandTool(shell: ShellInfo, registry: ProcessRegistry): Tool<RunArgs> {
  return {
    name: 'run_command',
    description: `Run a shell command (${shell.label}) in the project folder and get its output and exit code: install packages, build, run tests, use git, etc. There is no terminal or keyboard input, so pass non-interactive flags. Default timeout 120s (max 600). Start dev servers and other long-running processes with background=true.`,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to run' },
        timeout: { type: 'integer', description: 'Seconds before the command is stopped. Default 120, max 600' },
        background: { type: 'boolean', description: 'Keep it running in the background (servers, watchers). Default false' },
      },
      required: ['command'],
    },
    kind: 'exec',
    label: (a) => `$ ${a.command}${a.background ? '  (background)' : ''}`,
    command: (a) => a.command,
    async prepare(args, ctx) {
      const cwd = ctx.workspace.root;
      const mistake = shellMistake(shell, args.command) ?? sdkGuard(args.command);
      if (mistake) return toolError(mistake);
      const command = windowsSwitches(shell, args.command);
      const background = args.background || isLongRunning(args.command) || extractsBigArchive(args.command, cwd);
      return {
        preview: { type: 'command', command: args.command, output: '', exitCode: null, background },
        run: () =>
          background
            ? runBackground(registry, shell, command, cwd, ctx.signal)
            : runForeground(shell, command, cwd, args.timeout ?? 120, ctx),
      };
    },
  };
}

interface ProcessArgs {
  action: 'list' | 'output' | 'stop';
  id?: string;
}

export function processTool(registry: ProcessRegistry): Tool<ProcessArgs> {
  return {
    name: 'process',
    description:
      'Manage background processes started with run_command background=true: "list" them, read new "output" from one, or "stop" one.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'output', 'stop'] },
        id: { type: 'string', description: 'Process id such as "p1" (for output and stop)' },
      },
      required: ['action'],
    },
    kind: 'meta',
    label: (a) => (a.action === 'list' ? 'List background processes' : `${a.action === 'stop' ? 'Stop' : 'Check'} ${a.id ?? ''}`.trim()),
    async prepare(args) {
      return {
        run: async () => {
          if (args.action === 'list') {
            const procs = registry.list();
            if (!procs.length) return { content: 'No background processes.' };
            return {
              content: procs
                .map((p) => `${p.id}  ${p.exited ? `exited (${p.exitCode})` : 'running'}  ${Math.round((Date.now() - p.startedAt) / 1000)}s  ${p.command}`)
                .join('\n'),
            };
          }
          const proc = args.id ? registry.get(args.id) : undefined;
          if (!proc) return toolError(`No background process "${args.id ?? ''}". Use action "list" to see them.`);
          if (args.action === 'stop') {
            registry.stop(proc.id);
            return { content: `Stopped ${proc.id} (${proc.command}).`, summary: 'stopped' };
          }
          const fresh = proc.output.slice(proc.readUpTo);
          proc.readUpTo = proc.output.length;
          const state = proc.exited ? `exited with code ${proc.exitCode}` : 'running';
          const address = proc.exited ? undefined : serverAddress(proc.output);
          return {
            content: `${proc.id} is ${state}.${address ? ` It is serving at ${address}.` : ''}\n${fresh ? `New output:\n${truncateMiddle(cleanOutput(fresh), 8000, 0.2)}` : 'No new output since the last check.'}`,
            summary: state,
          };
        },
      };
    },
  };
}
