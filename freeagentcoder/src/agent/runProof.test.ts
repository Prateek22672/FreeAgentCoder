import { describe, expect, it } from 'vitest';
import { appAddress, appErrors, runProof, type Probe } from './runProof';

const answers = (ok: string[]): Probe => async (url) => (ok.includes(url) ? true : 'the connection was refused');

describe('a run task ends with a link that opens', () => {
    it('sends the agent back when it hands the work to the user (a real reply)', async () => {
        const reply =
            "I can't run the Flutter app because Flutter isn't installed on this system. To run it yourself: download Flutter, then run flutter run -d chrome. You'll need to install Flutter first.";
        const verdict = await runProof(reply, [], answers([]));
        expect(verdict?.feedback).toMatch(/Do it yourself/);
        expect(verdict?.notice).toMatch(/hands the work back/);
    });

    it('sends the agent back when the link it gave is not being served', async () => {
        expect((await runProof('Your app is running at http://localhost:3000', [], answers([])))?.feedback).toMatch(/nothing is serving it: no background process/);
        expect((await runProof('Open http://localhost:3000', ['http://localhost:8080'], answers([])))?.notice).toBe(
            'Not verified: nothing is serving http://localhost:3000 (the app is at http://localhost:8080). Ignore that link; still working.',
        );
    });

    it('opens the link itself: 127.0.0.1 refused while the server listened on [::1] (a real chat)', async () => {
        const verdict = await runProof(
            'Open http://127.0.0.1:8084 in a browser. fetch_url returns the Flutter app HTML page.',
            ['http://localhost:8084'],
            answers(['http://localhost:8084']),
        );
        expect(verdict?.feedback).toContain('opened http://127.0.0.1:8084 and the connection was refused');
        expect(verdict?.feedback).toContain('do not write addresses');
        expect(verdict?.notice).toBe('Not verified: FreeAgentCoder opened http://127.0.0.1:8084 and the connection was refused; the app is at http://localhost:8084. Ignore that link; still working.');
    });

    it('does not accept "it is running" when nothing runs', async () => {
        expect((await runProof('Done! The wallpaper app is now running.', [], answers([])))?.notice).toMatch(/nothing is running yet/);
    });

    it('lets it finish with a link that opens, a reply without links, or an honest blocker', async () => {
        expect(await runProof('It is running: http://localhost:8080', ['http://localhost:8080'], answers(['http://localhost:8080']))).toBeUndefined();
        expect(await runProof('The wallpaper app is running.', ['http://localhost:8080'], answers([]))).toBeUndefined();
        expect(await runProof('It needs administrator rights to install the Android SDK, which I cannot grant. Everything else is ready.', [], answers([]))).toBeUndefined();
    });
});

describe('the address and errors of a running app, from its own output', () => {
    it('takes the address the server printed for the app, not Flutter\'s debug service', () => {
        const chrome = [
            'Launching lib\\main.dart on Chrome in debug mode...',
            'Waiting for connection from debug service on Chrome...          21.3s',
            'This app is linked to the debug service: ws://127.0.0.1:53110/Qe2xRw3HhE8=/ws',
            'A Dart VM Service on Chrome is available at: http://127.0.0.1:53110/Qe2xRw3HhE8=',
            'The Flutter DevTools debugger and profiler on Chrome is available at: http://127.0.0.1:9100?uri=http://127.0.0.1:53110/Qe2xRw3HhE8=',
        ].join('\n');
        expect(appAddress(chrome, 'flutter run -d chrome --web-port 8087 --web-hostname localhost')).toBe('http://localhost:8087');
        expect(appAddress('lib\\main.dart is being served at http://localhost:8084\n', 'flutter run -d web-server')).toBe('http://localhost:8084');
        expect(appAddress('  ➜  Local:   http://localhost:5173/\n')).toBe('http://localhost:5173');
        expect(appAddress('Compiling...', 'npm run dev')).toBeUndefined();
    });

    it('reads the error the app shows instead of calling it working (the red screen in a real chat)', () => {
        const output = [
            '══╡ EXCEPTION CAUGHT BY WIDGETS LIBRARY ╞═══════════════════════════════════════',
            'The following ProviderNotFoundException was thrown building HomeScreen(dirty):',
            'Error: Could not find the correct Provider<WallpaperProvider> above this HomeScreen Widget',
            '',
            'Another exception was thrown: Error: Could not find the correct Provider<WallpaperProvider> above this HomeScreen Widget',
        ].join('\n');
        expect(appErrors(output)[0]).toContain('ProviderNotFoundException was thrown building HomeScreen');
        expect(appErrors('lib/main.dart:26:60: Error: The getter \'Provider\' isn\'t defined')).toHaveLength(1);
        expect(appErrors('lib\\main.dart is being served at http://localhost:8084')).toEqual([]);
    });
});

describe('an app that is still starting', () => {
    it('is starting until its server says where it is served (a Flutter web build takes minutes)', async () => {
        const { stillStarting } = await import('./runProof');
        const cmd = 'cd app && flutter run -d web-server --web-port 8080 --web-hostname 127.0.0.1';
        expect(stillStarting('Launching lib\main.dart on Web Server in debug mode...\nWaiting for connection from debug service on Web Server...', cmd)).toBe(true);
        expect(stillStarting('Waiting for connection...  52.5s\nlib\main.dart is being served at http://127.0.0.1:8080', cmd)).toBe(false);
        expect(stillStarting('  VITE v6  ready in 300 ms\n  ➜  Local:   http://localhost:5173/', 'npm run dev')).toBe(false);
        expect(stillStarting('Compiling...', 'npm run dev')).toBe(true);
    });
});
