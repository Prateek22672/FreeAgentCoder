import { describe, expect, it } from 'vitest';
import { serverAddress, shellMistake, windowsSwitches, type ShellInfo } from '../src/node/shell';

const bash: ShellInfo = { kind: 'bash', path: 'bash', label: 'Git Bash' };
const powershell: ShellInfo = { kind: 'powershell', path: 'powershell', label: 'PowerShell' };

describe('commands written for another shell', () => {
  it('refuses %VAR% in Git Bash, which made a folder named "%USERPROFILE%" in a real chat', () => {
    const message = shellMistake(bash, 'mkdir -p %USERPROFILE%\\flutter && tar -xf flutter.zip -C %USERPROFILE%\\flutter');
    expect(message).toMatch(/does not expand %USERPROFILE%/);
    expect(message).toContain('"$USERPROFILE"');
  });

  it('gives PowerShell its own spelling', () => {
    expect(shellMistake(powershell, 'Expand-Archive x.zip %LOCALAPPDATA%\\sdk')).toContain('$env:LOCALAPPDATA');
  });

  it('refuses $env:VAR in Git Bash', () => {
    expect(shellMistake(bash, 'ls $env:LOCALAPPDATA/sdk')).toMatch(/is PowerShell/);
  });

  it('leaves alone commands handed to cmd or PowerShell, and % used for formats', () => {
    expect(shellMistake(bash, 'cmd //c "echo %USERPROFILE%"')).toBeUndefined();
    expect(shellMistake(bash, "powershell -NoProfile -Command 'Get-ChildItem $env:LOCALAPPDATA'")).toBeUndefined();
    expect(shellMistake(bash, 'powershell -Command "Get-Date"')).toBeUndefined();
    expect(shellMistake(bash, 'date +%Y%m%d && git log --format=%H%n')).toBeUndefined();
    expect(shellMistake(bash, 'printf "%s%%\\n" 50')).toBeUndefined();
    expect(shellMistake(bash, 'ls "$USERPROFILE/flutter"')).toBeUndefined();
  });
});

describe('PowerShell code inside double quotes in Git Bash', () => {
  it('is refused: bash expands $env:X and $_ first (a real chat got "/usr/bin/bash" for $_)', () => {
    expect(shellMistake(bash, 'powershell -Command "Test-Path \"$env:LOCALAPPDATA\\FreeAgentCoder\""')).toMatch(/single quotes/);
    expect(shellMistake(bash, 'powershell -Command "@(1,2) | ForEach-Object { $_ }"')).toMatch(/single quotes/);
    expect(shellMistake(bash, "powershell -Command 'Get-Process | ForEach-Object { $_.Id }'")).toBeUndefined();
  });
});

describe('Windows programs with slash switches in Git Bash', () => {
  it('run with path conversion off, so /c and /PID reach the program', () => {
    expect(windowsSwitches(bash, 'cmd.exe /c "taskkill /PID 15368 /F"', 'win32')).toBe('MSYS_NO_PATHCONV=1 cmd.exe /c "taskkill /PID 15368 /F"');
    expect(windowsSwitches(bash, 'taskkill /PID 15368 /F', 'win32')).toBe('MSYS_NO_PATHCONV=1 taskkill /PID 15368 /F');
    expect(windowsSwitches(bash, 'netstat -ano | findstr /C:":8080"', 'win32')).toBe('netstat -ano | MSYS_NO_PATHCONV=1 findstr /C:":8080"');
    expect(windowsSwitches(bash, 'cd app && cmd /c dir', 'win32')).toBe('cd app && MSYS_NO_PATHCONV=1 cmd /c dir');
  });

  it('leaves everything else alone', () => {
    expect(windowsSwitches(bash, 'ls /c/Users/Lenovo && tar -xzf /c/x.tar.gz', 'win32')).toBe('ls /c/Users/Lenovo && tar -xzf /c/x.tar.gz');
    expect(windowsSwitches(bash, 'MSYS_NO_PATHCONV=1 cmd /c dir', 'win32')).toBe('MSYS_NO_PATHCONV=1 cmd /c dir');
    expect(windowsSwitches(bash, 'taskkill /PID 1', 'linux')).toBe('taskkill /PID 1');
    expect(windowsSwitches(powershell, 'taskkill /PID 1 /F', 'win32')).toBe('taskkill /PID 1 /F');
  });
});

describe('the address a server printed', () => {
  it('finds it in Vite, Flutter and Python output', () => {
    expect(serverAddress('  \u001b[32m➜\u001b[39m  Local:   http://localhost:5173/\n')).toBe('http://localhost:5173/');
    expect(serverAddress('lib\\main.dart is being served at http://localhost:8080')).toBe('http://localhost:8080');
    expect(serverAddress('Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/) ...')).toBe('http://localhost:8000/');
    expect(serverAddress('Compiling...')).toBeUndefined();
  });
});
