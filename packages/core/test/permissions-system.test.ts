import { describe, expect, it } from 'vitest';
import { dangerousReason, PermissionPolicy } from '../src/agent/permissions';

describe('system-level commands', () => {
  it.each([
    'choco install flutter -y',
    'winget install Google.Flutter',
    'brew install --cask flutter',
    'apt-get install -y openjdk-17-jdk',
    'npm install -g typescript',
    'npm i -g pnpm',
    'yarn global add serve',
    `echo 'export PATH="$HOME/flutter/bin:$PATH"' >> ~/.bashrc`,
    'setx PATH "%PATH%;C:\\flutter\\bin"',
    'Add-Content -Path $PROFILE -Value "hello"',
  ])('asks before: %s', (command) => {
    expect(dangerousReason(command)).not.toBeNull();
  });

  it.each([
    'npm install',
    'npm install --save-dev vitest',
    'pip install -r requirements.txt',
    'flutter pub get',
    'cat ~/.bashrc',
    'git clone --depth 1 https://github.com/flutter/flutter.git',
  ])('does not flag: %s', (command) => {
    expect(dangerousReason(command)).toBeNull();
  });

  it('asks even in auto mode and never offers to remember the answer', () => {
    const verdict = new PermissionPolicy('auto').evaluate({ kind: 'exec', command: 'choco install flutter -y', outsideProject: false });
    expect(verdict).toEqual({ action: 'ask', reason: 'installs or removes software system-wide', canRemember: false });
  });
});
