import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

/**
 * Loads a web page in a browser nobody sees and reports what went wrong:
 * uncaught errors, console errors, files that failed to load, and the text
 * the page ended up showing.
 *
 * A model can write a page that reads well and crashes on its first line; it
 * cannot know without running it. This is the running. It uses a Chromium
 * browser already on the computer (Chrome, Edge, Brave, Chromium) — Edge
 * ships with Windows — started headless with a throwaway profile, and needs
 * nothing installed. With no such browser the check is skipped, not failed.
 */

export interface PageReport {
    /** Uncaught exceptions, console.error output, and resources that failed to load. */
    errors: string[];
    warnings: string[];
    title: string;
    /** The text the page shows once its scripts have run. */
    text: string;
    /** Elements in the page body, as a rough sign that something was drawn. */
    elements: number;
    /** Content that does not fit: a page wider than its window, or a box whose content is cut off. */
    layout: string[];
    /** What the caller's script returned, as JSON, when one was run. */
    scriptResult?: string;
    /** Why the caller's script failed, when it threw. */
    scriptError?: string;
}

const PROBE_ID = '__fac_probe';

/**
 * Runs inside the page once it has loaded: measures what does not fit, then
 * runs the caller's script (which may click things and wait), and leaves the
 * findings in the page for the dump to carry out.
 */
export function probeScript(script?: string): string {
    const run = script ? `await (async () => { ${script}\n })()` : 'undefined';
    return `(() => {
  const done = (data) => {
    const out = document.createElement('script');
    out.type = 'application/json';
    out.id = '${PROBE_ID}';
    out.textContent = JSON.stringify(data).replace(/</g, '\\\\u003c');
    document.documentElement.appendChild(out);
  };
  const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : el.classList.length ? '.' + el.classList[0] : '');
  const measure = () => {
    const layout = [];
    const root = document.documentElement;
    if (root.scrollWidth > window.innerWidth + 4) {
      layout.push('The page is wider than the window (' + root.scrollWidth + 'px of content in ' + window.innerWidth + 'px), so it scrolls sideways.');
    }
    for (const el of document.querySelectorAll('body *')) {
      if (layout.length >= 4) break;
      const style = getComputedStyle(el);
      const over = el.clientWidth > 80 && el.scrollWidth > el.clientWidth + 8 && style.textOverflow !== 'ellipsis';
      if (over && (style.overflowX === 'hidden' || style.overflowX === 'clip')) {
        layout.push(name(el) + ' cuts off its content: ' + el.scrollWidth + 'px wide inside ' + el.clientWidth + 'px.');
      } else if (over && (style.overflowX === 'auto' || style.overflowX === 'scroll') && !/^(PRE|CODE|TABLE|TEXTAREA)$/.test(el.tagName) && !/scroll|carousel|slider|track|marquee/i.test(String(el.className))) {
        layout.push(name(el) + ' scrolls sideways: its content is ' + el.scrollWidth + 'px wide inside ' + el.clientWidth + 'px.');
      }
    }
    return layout;
  };
  const start = async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const data = { layout: measure() };
    try {
      const value = ${run};
      if (${script ? 'true' : 'false'}) data.result = value === undefined ? 'undefined' : JSON.stringify(value);
    } catch (error) {
      data.error = String(error && error.message ? error.message : error);
    }
    done(data);
  };
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
})();`;
}

/** What the probe left in the page. */
export function readProbe(html: string): { layout: string[]; scriptResult?: string; scriptError?: string } {
    const raw = new RegExp(`<script[^>]*id="${PROBE_ID}"[^>]*>([\\s\\S]*?)</script>`, 'i').exec(html)?.[1];
    if (!raw) {
        return { layout: [] };
    }
    try {
        const data = JSON.parse(raw) as { layout?: unknown; result?: unknown; error?: unknown };
        return {
            layout: Array.isArray(data.layout) ? data.layout.filter((item): item is string => typeof item === 'string').slice(0, 4) : [],
            scriptResult: typeof data.result === 'string' ? data.result.slice(0, 2_000) : undefined,
            scriptError: typeof data.error === 'string' ? data.error.slice(0, 500) : undefined,
        };
    } catch {
        return { layout: [] };
    }
}

type Exists = (file: string) => Promise<boolean>;

const onDisk: Exists = (file) =>
    fs.access(file).then(
        () => true,
        () => false,
    );

/** Where Chromium browsers live, most common first. */
export function browserCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
    if (platform === 'win32') {
        const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter((root): root is string => !!root);
        const apps = ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe', 'Chromium\\Application\\chrome.exe'];
        return apps.flatMap((app) => roots.map((root) => path.win32.join(root, app)));
    }
    if (platform === 'darwin') {
        return ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium'].map((name) => `/Applications/${name}.app/Contents/MacOS/${name}`);
    }
    const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser'];
    const folders = (env.PATH ?? '').split(':').filter(Boolean);
    return names.flatMap((name) => folders.map((folder) => path.posix.join(folder, name)));
}

let found: Promise<string | undefined> | undefined;

/** A Chromium browser on this computer, or undefined. Looked up once. */
export function findBrowser(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, exists: Exists = onDisk): Promise<string | undefined> {
    const search = async () => {
        for (const candidate of browserCandidates(platform, env)) {
            if (await exists(candidate)) {
                return candidate;
            }
        }
        return undefined;
    };
    if (exists !== onDisk) {
        return search();
    }
    return (found ??= search());
}

/** `[pid:tid:time:LEVEL:CONSOLE:61] "message", source: http://… (61)` — also the older `CONSOLE(61)` form. */
const CONSOLE_LINE = /:(INFO|WARNING|ERROR):CONSOLE[:(](\d+)\)?\]\s+"([\s\S]*)",\s+source:\s+(\S*)\s+\((\d+)\)\s*$/;
/** Noise that says nothing about the page: a missing favicon, the browser's own extensions. */
const IGNORED_SOURCE = /^(chrome-extension|extensions|devtools|chrome|edge):/i;

/** Console messages from the browser's log, sorted into errors and warnings, with where each came from. */
export function parseConsole(log: string, origin = ''): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const line of log.split(/\r?\n/)) {
        const match = CONSOLE_LINE.exec(line);
        if (!match) {
            continue;
        }
        const [, level, , message, source, lineNumber] = match;
        if (IGNORED_SOURCE.test(source!) || /favicon\.ico/i.test(message!) || /favicon\.ico/i.test(source!)) {
            continue;
        }
        const where = source ? ` (${origin && source.startsWith(origin) ? source.slice(origin.length).replace(/^\//, '') : source}:${lineNumber})` : '';
        const text = `${message!.replace(/\\"/g, '"').trim()}${where}`;
        const isError = level === 'ERROR' || /^Uncaught\b/.test(message!) || /Failed to load|net::ERR_|is not defined|SyntaxError|blocked by CORS/i.test(message!);
        const list = isError ? errors : level === 'WARNING' ? warnings : undefined;
        if (list && !list.includes(text)) {
            list.push(text);
        }
    }
    return { errors: errors.slice(0, 12), warnings: warnings.slice(0, 6) };
}

/** What a person would read on the page: its title and its text, without scripts, styles or tags. */
export function readDom(html: string): { title: string; text: string; elements: number } {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? '';
    const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
    const visible = body.replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1>/gi, ' ');
    const elements = (visible.match(/<[a-z][^>]*>/gi) ?? []).length;
    const text = visible
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
    return { title, text: text.slice(0, 1_200), elements };
}

/**
 * Loads `url` and reports on it. Scripts get eight seconds of the page's own
 * time to run (timers included) before the page is read.
 */
export async function checkPage(browser: string, url: string, signal?: AbortSignal): Promise<PageReport> {
    const profile = await fs.mkdtemp(path.join(tmpdir(), 'fac-page-'));
    try {
        const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
            const child = spawn(
                browser,
                [
                    '--headless=new',
                    '--disable-gpu',
                    '--no-first-run',
                    '--no-default-browser-check',
                    '--disable-extensions',
                    '--mute-audio',
                    `--user-data-dir=${profile}`,
                    '--enable-logging=stderr',
                    '--v=0',
                    '--window-size=1280,800',
                    '--virtual-time-budget=8000',
                    '--dump-dom',
                    url,
                ],
                { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
            );
            let out = '';
            let err = '';
            child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
            child.stderr.on('data', (chunk: Buffer) => (err = (err + chunk.toString('utf8')).slice(-400_000)));
            const stop = () => child.kill();
            const timer = setTimeout(stop, 40_000);
            signal?.addEventListener('abort', stop, { once: true });
            child.on('error', (error) => {
                clearTimeout(timer);
                reject(error);
            });
            child.on('close', () => {
                clearTimeout(timer);
                signal?.removeEventListener('abort', stop);
                resolve({ stdout: out, stderr: err });
            });
        });
        const origin = /^https?:\/\/[^/]+/i.exec(url)?.[0] ?? '';
        const dom = readDom(stdout);
        const consoleOutput = parseConsole(stderr, origin);
        if (!stdout.trim() && !consoleOutput.errors.length) {
            consoleOutput.errors.push('The page did not load: the browser returned nothing.');
        }
        return { ...consoleOutput, ...dom, ...readProbe(stdout) };
    } finally {
        // The browser can hold its profile for a moment after it exits.
        void fs.rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }).catch(() => undefined);
    }
}

/** The report as the agent reads it. */
export function describeReport(page: string, report: PageReport): string {
    const lines = [report.errors.length ? `Loaded ${page} in a browser: ${report.errors.length} error${report.errors.length === 1 ? '' : 's'}.` : `Loaded ${page} in a browser: no errors.`];
    for (const error of report.errors) {
        lines.push(`- ${error}`);
    }
    if (report.warnings.length) {
        lines.push('Warnings:', ...report.warnings.map((warning) => `- ${warning}`));
    }
    if (report.layout.length) {
        lines.push('Layout, at a 1280px window:', ...report.layout.map((item) => `- ${item}`));
    }
    if (report.scriptError !== undefined) {
        lines.push(`Your script threw: ${report.scriptError}`);
    } else if (report.scriptResult !== undefined) {
        lines.push(`Your script returned: ${report.scriptResult}`);
    }
    lines.push(`Title: ${report.title || '(none)'} · ${report.elements} elements in the body.`);
    lines.push(report.text ? `Text on the page: ${report.text}` : 'The page shows no text.');
    return lines.join('\n');
}
