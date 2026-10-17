import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { appKey, isLongRunning, MAX_STARTS, portBusy, portIn, ProcessRegistry, startProblem } from '../src/node/shell';
import { bracketProblem, bracketsBroken } from '../src/util/brackets';

/** Regression cases from a real chat where the agent could not run a Flutter app. */

const SETTINGS = `import 'package:flutter/material.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final name = 'Dark \${'mode'} {not a brace}';
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: Column(children: [Text("a } in a string"), Text('\${name}')]),
    );
  }
}
`;

describe('edits that break a file', () => {
  it('reads strings, interpolation and comments, so a balanced file is balanced', () => {
    expect(bracketProblem(SETTINGS)).toBeUndefined();
    expect(bracketProblem('const a = `x ${b({c: 1})} }`; // }\n/* { */')).toBeUndefined();
  });

  it('refuses an edit that adds a stray closing brace (what the agent did, over and over)', () => {
    const after = SETTINGS.replace(/}\n$/, '}\n}\n');
    expect(bracketsBroken('lib/screens/settings_screen.dart', SETTINGS, after)).toMatch(/Not changed: .*has nothing to close/);
  });

  it('refuses an edit that drops the end of a widget', () => {
    const after = SETTINGS.replace('    );\n  }\n}', '    );\n');
    expect(bracketsBroken('settings_screen.dart', SETTINGS, after)).toMatch(/never closed/);
  });

  it('lets through a sound edit, a file that was already broken, and files that are not code', () => {
    expect(bracketsBroken('a.dart', SETTINGS, SETTINGS.replace("'Settings'", "'Preferences'"))).toBeUndefined();
    expect(bracketsBroken('a.dart', `${SETTINGS}}`, `${SETTINGS}}}`)).toBeUndefined();
    expect(bracketsBroken('notes.md', '(a)', '(a')).toBeUndefined();
  });
});

describe('servers and ports', () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  it('always runs servers in the background (a Flutter server was killed at the time-out just as it came up)', () => {
    expect(isLongRunning('cd "C:/a/app" && "/c/sdk/flutter/bin/flutter.bat" run -d web-server --web-port 8084')).toBe(true);
    expect(isLongRunning('npm run dev')).toBe(true);
    expect(isLongRunning('python -m http.server 8000')).toBe(true);
    expect(isLongRunning('flutter pub get')).toBe(false);
    expect(isLongRunning('npm run build')).toBe(false);
  });

  it('reads the port from the usual flags', () => {
    expect(portIn('flutter run -d web-server --web-port 8084 --web-hostname 127.0.0.1')).toBe(8084);
    expect(portIn('npx vite --port=5174')).toBe(5174);
    expect(portIn('python -m http.server 8000')).toBe(8000);
    expect(portIn('npm run dev')).toBeUndefined();
  });

  it('knows one app whatever its port and flags', () => {
    expect(appKey('cd "C:/a/wallpaper_app" && "/c/sdk/flutter/bin/flutter.bat" run -d web-server --web-port 8081 --no-pub')).toBe('flutter run');
    expect(appKey('flutter run -d web-server --web-port 8084')).toBe('flutter run');
  });

  it('does not start on a port another program holds, and names a free one', async () => {
    server = createServer();
    const port = await new Promise<number>((resolve) => server!.listen(0, '::1', () => resolve((server!.address() as { port: number }).port)));
    expect(await portBusy(port)).toBe(true);
    const problem = await startProblem(new ProcessRegistry(), `flutter run -d web-server --web-port ${port}`);
    expect(problem).toMatch(new RegExp(`port ${port} is already in use by another program`));
    expect(problem).toMatch(/Do not stop a program you did not start; use port \d+ instead \(it is free\)/);
  });

  it('stops after a bounded number of starts in one task, and counts again in the next', async () => {
    const registry = new ProcessRegistry();
    for (let i = 0; i < MAX_STARTS; i++) {
      expect(await startProblem(registry, `flutter run -d web-server --web-port ${9100 + i}`)).toBeUndefined();
    }
    expect(await startProblem(registry, 'flutter run -d web-server --web-port 9200 --no-pub')).toMatch(/started 3 times in this task.*Stop here/);
    registry.newTask();
    expect(await startProblem(registry, 'flutter run -d web-server --web-port 9201')).toBeUndefined();
  });
});
