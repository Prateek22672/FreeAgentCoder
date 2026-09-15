import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { toolError, type Tool, type ToolContext, type ToolResult } from '../tools/types';
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
  return {
    ...process.env,
    PAGER: 'cat',
    GIT_PAGER: 'cat',
    GIT_TERMINAL_PROMPT: '0',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    npm_config_yes: 'true',
    PYTHONUNBUFFERED: '1',
  };
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

/** Long-running processes (dev servers, watchers) the agent started. */
export class ProcessRegistry {
  private procs = new Map<string, BackgroundProcess>();
  private counter = 0;

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
        ? `Timed out after ${timeoutMs / 1000}s and was stopped. For servers or watchers use background=true.`
        : interrupted
          ? 'Stopped: the user interrupted.'
          : `Exit code: ${code ?? sig}`;
      settle({
        content: `${status}\n${truncateMiddle(clean, 12_000, 0.2) || '(no output)'}`,
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
  const proc = registry.start(shell, command, cwd);
  const ready = /localhost:\d+|127\.0\.0\.1:\d+|ready in|listening (on|at)|compiled successfully|started server|server running/i;
  for (let waited = 0; waited < 8000 && !proc.exited && !signal.aborted; waited += 250) {
    if (ready.test(proc.output)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.readUpTo = proc.output.length;
  const out = truncateMiddle(cleanOutput(proc.output), 4000, 0.3) || '(no output yet)';
  const state = proc.exited
    ? `It already exited with code ${proc.exitCode}.`
    : 'It is still running. Use the process tool to read more output or stop it.';
  return {
    content: `Started background process ${proc.id}: ${command}\n${state}\nOutput so far:\n${out}`,
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
      return {
        preview: { type: 'command', command: args.command, output: '', exitCode: null, background: args.background },
        run: () =>
          args.background
            ? runBackground(registry, shell, args.command, cwd, ctx.signal)
            : runForeground(shell, args.command, cwd, args.timeout ?? 120, ctx),
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
          return {
            content: `${proc.id} is ${state}.\n${fresh ? `New output:\n${truncateMiddle(cleanOutput(fresh), 8000, 0.2)}` : 'No new output since the last check.'}`,
            summary: state,
          };
        },
      };
    },
  };
}
