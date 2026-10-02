import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browserCandidates, checkPage, describeReport, findBrowser, parseConsole, probeScript, readDom, readProbe, type PageReport } from './checkPage';
import { isBlank, pageFeedback, pageProblem, PagePreviews, previewLocation } from './pages';
import { startStaticServer, type StaticServer } from './staticServer';

const report = (over: Partial<PageReport> = {}): PageReport => ({ errors: [], warnings: [], title: 'Game', text: 'Roll', elements: 9, layout: [], ...over });

describe('reading the browser log', () => {
    const log = [
        '[19984:9744:1002/185137.540:INFO:CONSOLE:61] "Uncaught TypeError: Cannot convert undefined or null to object", source: http://127.0.0.1:64610/js/board.js (61)',
        '[20884:22656:1002/185141.428:INFO:CONSOLE:5645] "[ProtocolLaunch] handler constructed; wiring port events.", source: chrome-extension://ndcp/background.rollup.js (5645)',
        '[20884:22656:1002/185140.949:ERROR:chrome\\browser\\task_manager\\providers\\fallback_task_provider.cc:126] Every renderer should have at least one task.',
        '[1:2:1002/1.1:ERROR:CONSOLE(0)] "Failed to load resource: the server responded with a status of 404 (Not Found)", source: http://127.0.0.1:64610/favicon.ico (0)',
        '[1:2:1002/1.1:ERROR:CONSOLE(0)] "Failed to load resource: the server responded with a status of 404 (Not Found)", source: http://127.0.0.1:64610/css/missing.css (0)',
        '[1:2:1002/1.1:WARNING:CONSOLE(12)] "Deprecated API", source: http://127.0.0.1:64610/js/ui.js (12)',
        '[1:2:1002/1.1:INFO:CONSOLE(3)] "game started", source: http://127.0.0.1:64610/js/game.js (3)',
        '[1:2:1002/1.1:INFO:CONSOLE:61] "Uncaught TypeError: Cannot convert undefined or null to object", source: http://127.0.0.1:64610/js/board.js (61)',
    ].join('\r\n');

    it('keeps the page’s own errors, once each, with the file and line', () => {
        const { errors, warnings } = parseConsole(log, 'http://127.0.0.1:64610');
        expect(errors).toEqual([
            'Uncaught TypeError: Cannot convert undefined or null to object (js/board.js:61)',
            'Failed to load resource: the server responded with a status of 404 (Not Found) (css/missing.css:0)',
        ]);
        expect(warnings).toEqual(['Deprecated API (js/ui.js:12)']);
    });

    it('finds nothing in a clean log', () => {
        expect(parseConsole('[1:2:3:INFO:CONSOLE(3)] "ready", source: http://x/a.js (3)\n')).toEqual({ errors: [], warnings: [] });
    });
});

describe('reading the page', () => {
    it('gives the title and the text a person would see', () => {
        const dom = readDom('<html><head><title>Snake &amp; Ladder</title><style>p{color:red}</style></head><body><h1>Snake &amp; Ladder</h1><script>let hidden = 1;</script><button>Roll dice</button></body></html>');
        expect(dom).toEqual({ title: 'Snake &amp; Ladder', text: 'Snake & Ladder Roll dice', elements: 2 });
    });
});

describe('finding a browser', () => {
    it('looks where Chrome and Edge are installed on each system', () => {
        const windows = browserCandidates('win32', { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' });
        expect(windows).toContain('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
        expect(windows).toContain('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
        expect(browserCandidates('darwin', {})[0]).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
        expect(browserCandidates('linux', { PATH: '/usr/bin:/snap/bin' })).toContain('/snap/bin/chromium');
    });

    it('takes the first one that exists, or none', async () => {
        const env = { PATH: '/usr/bin' };
        expect(await findBrowser('linux', env, async (file) => file === '/usr/bin/chromium')).toBe('/usr/bin/chromium');
        expect(await findBrowser('linux', env, async () => false)).toBeUndefined();
    });
});

describe('describing a report', () => {
    it('leads with the errors', () => {
        const text = describeReport('game/index.html', report({ errors: ['Uncaught ReferenceError: board is not defined (js/ui.js:4)'] }));
        expect(text.split('\n')[0]).toBe('Loaded game/index.html in a browser: 1 error.');
        expect(text).toContain('- Uncaught ReferenceError: board is not defined (js/ui.js:4)');
        expect(describeReport('a.html', report({ title: '', text: '', elements: 0 }))).toContain('no errors');
    });

    it('says what the script returned, or why it failed', () => {
        expect(describeReport('a.html', report({ scriptResult: '{"position":"5"}' }))).toContain('Your script returned: {"position":"5"}');
        expect(describeReport('a.html', report({ scriptError: 'roll is null' }))).toContain('Your script threw: roll is null');
        expect(describeReport('a.html', report({ layout: ['div#board cuts off its content: 640px wide inside 432px.'] }))).toContain('- div#board cuts off its content');
    });
});

describe('what sends the agent back', () => {
    it('is a crash or a blank page, every time', () => {
        expect(pageProblem(report())).toBeUndefined();
        expect(pageFeedback('a.html', report())).toBeUndefined();
        expect(pageProblem(report({ errors: ['Uncaught TypeError: x (js/a.js:1)'] }))).toBe('1 error: Uncaught TypeError: x (js/a.js:1)');
        expect(isBlank(report({ text: '', elements: 0 }))).toBe(true);
        expect(pageFeedback('a.html', report({ text: '', elements: 1 }))).toContain('The page is blank');
    });

    it('is content that does not fit, once only', () => {
        const cut = report({ layout: ['div#board cuts off its content: 640px wide inside 432px.'] });
        expect(pageFeedback('a.html', cut, true)).toContain('part of the page does not fit');
        expect(pageFeedback('a.html', cut, false)).toBeUndefined();
    });
});

describe('where a page is served from', () => {
    const workspace = path.resolve('/work/space');

    it('serves the project folder the page is in, not the whole workspace', () => {
        expect(previewLocation(workspace, 'snake-and-ladder/index.html')).toEqual({ root: path.join(workspace, 'snake-and-ladder'), urlPath: '/index.html' });
        expect(previewLocation(workspace, 'site/pages/about us.html')).toEqual({ root: path.join(workspace, 'site'), urlPath: '/pages/about%20us.html' });
        expect(previewLocation(workspace, 'index.html')).toEqual({ root: workspace, urlPath: '/index.html' });
    });

    it('refuses anything that is not a page inside the workspace', () => {
        expect(previewLocation(workspace, '../other/index.html')).toBeUndefined();
        expect(previewLocation(workspace, 'js/game.js')).toBeUndefined();
    });
});

describe('the probe', () => {
    it('is read back from the page it ran in', () => {
        const html = '<html><body><p>x</p></body><script type="application/json" id="__fac_probe">{"layout":["wide"],"result":"{\\"a\\":1}"}</script></html>';
        expect(readProbe(html)).toEqual({ layout: ['wide'], scriptResult: '{"a":1}', scriptError: undefined });
        expect(readProbe('<html></html>')).toEqual({ layout: [] });
        // The probe's own tag never shows up as page text.
        expect(readDom(html).text).toBe('x');
    });

    it('wraps the caller’s script so it can wait and return', () => {
        expect(probeScript('return 1;')).toContain('await (async () => { return 1;');
        expect(probeScript()).not.toContain('await (async () => {');
    });
});

// A real browser, when this computer has one: the check that matters most.
describe('loading a real page', async () => {
    const browser = await findBrowser();
    let base: string;
    let server: StaticServer;

    beforeAll(async () => {
        base = await mkdtemp(path.join(tmpdir(), 'fac-check-'));
        await mkdir(path.join(base, 'js'), { recursive: true });
        await writeFile(path.join(base, 'good.html'), '<!doctype html><title>Good</title><div id="app"></div><script type="module" src="js/good.js"></script>');
        await writeFile(path.join(base, 'js', 'good.js'), "import { name } from './name.js';\nsetTimeout(() => { document.getElementById('app').textContent = `Hello ${name}`; }, 50);");
        await writeFile(path.join(base, 'js', 'name.js'), "export const name = 'board';");
        await writeFile(path.join(base, 'bad.html'), '<!doctype html><title>Bad</title><div id="app">Loading</div><script type="module" src="js/bad.js"></script>');
        await writeFile(path.join(base, 'js', 'bad.js'), 'const squares = undefined;\nObject.entries(squares);');
        await writeFile(
            path.join(base, 'counter.html'),
            '<!doctype html><title>Counter</title><button id="add">Add</button><output id="n">0</output><div id="board" style="width:300px;overflow:hidden"><div style="width:900px">a very wide row</div></div><div class="wrap" style="width:400px;overflow:auto"><div style="width:600px">wider than its box</div></div><pre style="width:200px;overflow:auto">a long line of code that is meant to scroll sideways inside its box</pre>' +
                "<script>let n = 0; document.getElementById('add').onclick = () => setTimeout(() => { document.getElementById('n').textContent = String(++n); }, 300);</script>",
        );
        server = await startStaticServer(base);
    });

    afterAll(async () => {
        server?.close();
        await rm(base, { recursive: true, force: true });
    });

    it.skipIf(!browser)(
        'runs the scripts and reads the result',
        async () => {
            const report = await checkPage(browser!, `${server.origin}/good.html`);
            expect(report.errors).toEqual([]);
            expect(report.title).toBe('Good');
            // Set by a module, from an import, after a timer: all of it ran.
            expect(report.text).toBe('Hello board');
            expect(report.layout).toEqual([]);
        },
        60_000,
    );

    it.skipIf(!browser)(
        'acts on the page like a user and reports what happened',
        async () => {
            const previews = new PagePreviews();
            const script = "document.getElementById('add').click(); document.getElementById('add').click(); await new Promise((r) => setTimeout(r, 1000)); return { count: document.getElementById('n').textContent, tag: '</script>' };";
            const page = await previews.check(base, 'counter.html', undefined, script);
            expect(page?.errors).toEqual([]);
            // Two clicks, each landing after a timer: the page really ran.
            expect(JSON.parse(page!.scriptResult!)).toEqual({ count: '2', tag: '</script>' });
            // Code is meant to scroll; a layout box is not.
            expect(page!.layout).toEqual(['div#board cuts off its content: 900px wide inside 300px.', 'div.wrap scrolls sideways: its content is 600px wide inside 400px.']);
            const failed = await previews.check(base, 'counter.html', undefined, "document.getElementById('missing').click();");
            expect(failed?.scriptError).toMatch(/null/);
            // The page a person previews is served without the probe.
            const url = await previews.urlFor(base, 'counter.html');
            expect(await (await fetch(url!)).text()).not.toContain('__fac_probe');
            previews.dispose();
        },
        90_000,
    );

    it.skipIf(!browser)(
        'reports a crash with its file and line',
        async () => {
            const report = await checkPage(browser!, `${server.origin}/bad.html`);
            expect(report.errors).toHaveLength(1);
            expect(report.errors[0]).toMatch(/^Uncaught TypeError: .*\(js\/bad\.js:2\)$/);
            expect(report.text).toBe('Loading');
        },
        60_000,
    );
});
