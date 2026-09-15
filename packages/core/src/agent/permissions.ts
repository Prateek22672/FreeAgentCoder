import type { ToolDisplay, ToolKind } from '../tools/types';

/**
 * ask       — reads are automatic; edits, commands and web access need approval
 * auto-edit — edits are automatic too; commands and web access still ask
 * auto      — everything is automatic except dangerous commands and anything
 *             outside the project folder
 */
export type PermissionMode = 'ask' | 'auto-edit' | 'auto';

export const PERMISSION_MODES: PermissionMode[] = ['ask', 'auto-edit', 'auto'];

export interface ApprovalRequest {
  tool: string;
  kind: ToolKind;
  label: string;
  preview?: ToolDisplay;
  command?: string;
  url?: string;
  paths: string[];
  outsideProject: boolean;
  /** Why approval is needed, e.g. "runs a command". */
  reason: string;
  /** Whether "always allow this" is on offer (never for dangerous actions). */
  canRemember: boolean;
}

export type ApprovalDecision = { allow: true; remember?: boolean } | { allow: false; feedback?: string };

export type Verdict =
  | { action: 'allow' }
  | { action: 'ask'; reason: string; canRemember: boolean }
  | { action: 'deny'; reason: string };

export interface PermissionInput {
  kind: ToolKind;
  command?: string;
  url?: string;
  outsideProject: boolean;
}

/** Never run, whatever the mode. */
const CATASTROPHIC: [RegExp, string][] = [
  [/\brm\s+(?:-[a-zA-Z]+\s+)+(?:\/|\/\*|~\/?|\$HOME\/?|\*|\.\/?)(?:\s|$)/, 'would delete an entire folder tree (rm -rf on /, ~, * or .)'],
  [/\b(?:rd|rmdir)\s+\/s\s+(?:\/q\s+)?[a-zA-Z]:\\?\s*$/i, 'would delete a whole drive'],
  [/\bRemove-Item\b.*\s[a-zA-Z]:\\?(?:\s|$)/i, 'would delete a whole drive'],
  [/\bmkfs(?:\.\w+)?\b/, 'formats a disk'],
  [/\bdd\b[^|]*\bof=\/dev\//, 'overwrites a disk device'],
  [/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, 'is a fork bomb'],
  [/\bformat\s+[a-zA-Z]:/i, 'formats a drive'],
];

/** Always asked about, even in auto mode, and never remembered. */
const DANGEROUS: [RegExp, string][] = [
  [/\brm\s+(?:-\w+\s+)*-\w*[rRf]/, 'deletes files (rm -r/-f)'],
  [/\b(?:rd|rmdir)\b.*\/s\b/i, 'deletes folders'],
  [/\bdel\b.*\/[sq]\b/i, 'deletes files'],
  [/\bRemove-Item\b/i, 'deletes files'],
  [/\bgit\s+push\b/, 'pushes to a remote repository'],
  [/\bgit\s+reset\s+--hard\b/, 'discards uncommitted work'],
  [/\bgit\s+clean\b/, 'deletes untracked files'],
  [/\bgit\s+(?:checkout|restore)\s+(?:--\s+)?\.(?:\s|$)/, 'discards uncommitted work'],
  [/\bgit\s+branch\s+-D\b/, 'force-deletes a branch'],
  [/\bgit\s+rebase\b/, 'rewrites git history'],
  [/\b(?:npm|pnpm|yarn|bun)\s+publish\b/, 'publishes a package'],
  [/\b(?:vercel|netlify|wrangler|firebase)\b.*\b(?:deploy|--prod)\b/i, 'deploys to production'],
  [/\bdrop\s+(?:table|database|schema)\b/i, 'drops database objects'],
  [/\btruncate\s+table\b/i, 'deletes table data'],
  [/\b(?:curl|wget|iwr|Invoke-WebRequest)\b[^|]*\|\s*(?:sh|bash|zsh|iex|powershell)\b/i, 'runs a script downloaded from the internet'],
  [/\b(?:Invoke-Expression|iex)\b/i, 'evaluates dynamic code'],
  [/\b(?:shutdown|reboot|halt|poweroff)\b/i, 'shuts down the machine'],
  [/\bkill(?:all)?\s+-9\b|\btaskkill\b.*\/f\b/i, 'force-kills processes'],
  [/\bchmod\s+-R\b|\bchown\s+-R\b/, 'changes permissions recursively'],
  [/\bdocker\s+(?:system\s+prune|rm|rmi|volume\s+rm)\b/, 'deletes Docker resources'],
  [/\bsudo\b|\brunas\b/i, 'runs with administrator rights'],
];

const SHELL_META = /[;&|`$<>(){}\n]/;
const READ_ONLY = new Set([
  'ls', 'dir', 'pwd', 'cat', 'head', 'tail', 'wc', 'tree', 'which', 'where', 'whoami', 'echo', 'stat', 'file', 'du', 'df',
  'get-childitem', 'gci', 'get-content', 'gc', 'get-location', 'gl',
]);
const GIT_READ_ONLY = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'blame', 'shortlog', 'describe']);

export function catastrophicReason(command: string): string | null {
  for (const [re, why] of CATASTROPHIC) if (re.test(command)) return why;
  return null;
}

export function dangerousReason(command: string): string | null {
  for (const [re, why] of DANGEROUS) if (re.test(command)) return why;
  return null;
}

/** Commands that only look at the project: auto-approved even in "ask" mode. */
export function isReadOnlyCommand(command: string): boolean {
  const cmd = command.trim();
  if (!cmd || SHELL_META.test(cmd)) return false;
  const tokens = cmd.split(/\s+/);
  const first = tokens[0]!.toLowerCase();
  const args = tokens.slice(1);
  // Stay inside the project: no absolute paths, home dirs or parent hops.
  if (args.some((a) => !a.startsWith('-') && (/^[/~]/.test(a) || /^[a-zA-Z]:/.test(a) || a.includes('..')))) return false;
  if (args.length === 1 && ['--version', '-v', '-V', 'version'].includes(args[0]!)) return true;
  if (READ_ONLY.has(first)) return true;
  if (first === 'git') {
    const sub = args[0];
    if (sub && GIT_READ_ONLY.has(sub)) return true;
    if (sub === 'branch') return args.slice(1).every((a) => ['-a', '-r', '-v', '-vv', '--list', '--show-current'].includes(a));
    if (sub === 'remote') return args.slice(1).every((a) => a === '-v');
  }
  return false;
}

/** The part of a command worth remembering: "npm run build", "git commit", "pytest". */
export function commandPrefix(command: string): string | null {
  const cmd = command.trim();
  if (!cmd || SHELL_META.test(cmd)) return null;
  const [a, b, c] = cmd.split(/\s+/);
  if (!a) return null;
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(a) && b === 'run' && c) return `${a} run ${c}`;
  if (b && /^[a-z][\w:.-]*$/i.test(b)) return `${a} ${b}`;
  return a;
}

function hostOf(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export class PermissionPolicy {
  mode: PermissionMode;
  private writesAllowed = false;
  private prefixes = new Set<string>();
  private exact = new Set<string>();
  private domains = new Set<string>();

  constructor(mode: PermissionMode = 'ask') {
    this.mode = mode;
  }

  evaluate(input: PermissionInput): Verdict {
    const { kind, command } = input;
    if (kind === 'exec' && command) {
      const blocked = catastrophicReason(command);
      if (blocked) return { action: 'deny', reason: blocked };
      const risky = dangerousReason(command);
      if (risky) return { action: 'ask', reason: risky, canRemember: false };
    }
    if (input.outsideProject && kind !== 'meta') {
      if (kind === 'read' && this.mode === 'auto') return { action: 'allow' };
      return { action: 'ask', reason: 'touches files outside the project folder', canRemember: false };
    }
    switch (kind) {
      case 'read':
      case 'meta':
        return { action: 'allow' };
      case 'write':
        return this.mode !== 'ask' || this.writesAllowed
          ? { action: 'allow' }
          : { action: 'ask', reason: 'changes files', canRemember: true };
      case 'exec': {
        const cmd = (command ?? '').trim();
        if (this.mode === 'auto' || isReadOnlyCommand(cmd) || this.commandAllowed(cmd)) return { action: 'allow' };
        return { action: 'ask', reason: 'runs a command', canRemember: true };
      }
      case 'network': {
        const host = hostOf(input.url);
        if (this.mode === 'auto' || (host && this.domains.has(host))) return { action: 'allow' };
        return { action: 'ask', reason: 'fetches a web page', canRemember: !!host };
      }
    }
  }

  private commandAllowed(cmd: string): boolean {
    if (this.exact.has(cmd)) return true;
    if (SHELL_META.test(cmd)) return false;
    for (const p of this.prefixes) if (cmd === p || cmd.startsWith(`${p} `)) return true;
    return false;
  }

  /** Record an "always allow" answer. Returns a description of the new rule. */
  remember(input: PermissionInput): string {
    if (input.kind === 'write') {
      this.writesAllowed = true;
      return 'all file changes for the rest of this session';
    }
    if (input.kind === 'exec' && input.command) {
      const prefix = commandPrefix(input.command);
      if (prefix) {
        this.prefixes.add(prefix);
        return `commands starting with "${prefix}" for this session`;
      }
      this.exact.add(input.command.trim());
      return 'this exact command for this session';
    }
    const host = hostOf(input.url);
    if (input.kind === 'network' && host) {
      this.domains.add(host);
      return `web requests to ${host} for this session`;
    }
    return 'nothing';
  }
}
