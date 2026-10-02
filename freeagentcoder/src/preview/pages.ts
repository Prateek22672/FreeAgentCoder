import * as path from 'node:path';
import { toolError, type Tool } from '@agentic/core';
import { checkPage, describeReport, findBrowser, probeScript, type PageReport } from './checkPage';
import { startStaticServer, type StaticServer } from './staticServer';

/**
 * Web pages in the open folder, served and checked on this computer: one
 * server at a time, moved when a page in another project folder is asked for.
 */

/** The folder to serve for a page, and the page's address inside it. */
export function previewLocation(workspace: string, target: string): { root: string; urlPath: string } | undefined {
    const relative = path.relative(workspace, path.resolve(workspace, target));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !/\.html?$/i.test(relative)) {
        return undefined;
    }
    // The project's own folder (the first one on the way to the page), not the whole workspace.
    const parts = relative.split(path.sep);
    const nested = parts.length > 1;
    return {
        root: nested ? path.join(workspace, parts[0]!) : path.resolve(workspace),
        urlPath: `/${(nested ? parts.slice(1) : parts).map(encodeURIComponent).join('/')}`,
    };
}

export class PagePreviews {
    private server?: StaticServer;

    /** A local address for a page inside the workspace, or undefined when it is not a page there. */
    async urlFor(workspace: string, target: string): Promise<string | undefined> {
        const location = previewLocation(workspace, target);
        if (!location) {
            return undefined;
        }
        if (this.server?.root !== path.resolve(location.root)) {
            this.server?.close();
            this.server = await startStaticServer(location.root);
        }
        return `${this.server.origin}${location.urlPath}`;
    }

    /**
     * Loads the page in a hidden browser, on a server of its own that adds the
     * probe (the preview a person looks at is never touched). `script` runs in
     * the page after it loads. Undefined when there is no browser to do it
     * with, or it is not a page here.
     */
    async check(workspace: string, target: string, signal?: AbortSignal, script?: string): Promise<PageReport | undefined> {
        const browser = await findBrowser();
        const location = browser ? previewLocation(workspace, target) : undefined;
        if (!browser || !location) {
            return undefined;
        }
        const server = await startStaticServer(location.root, { inject: probeScript(script) });
        try {
            return await checkPage(browser, `${server.origin}${location.urlPath}`, signal);
        } finally {
            server.close();
        }
    }

    dispose(): void {
        this.server?.close();
        this.server = undefined;
    }
}

/** Whether a page that loaded cleanly still shows nothing at all. */
export function isBlank(report: PageReport): boolean {
    return !report.errors.length && !report.text && report.elements < 2;
}

/**
 * What is wrong with the page in a few words, or undefined when it works.
 * Content that does not fit counts only when `layout` is set: it is worth one
 * trip back to fix, but can be intended, so it never blocks twice.
 */
export function pageProblem(report: PageReport, layout = false): string | undefined {
    if (isBlank(report)) {
        return 'it loads but shows nothing';
    }
    if (report.errors.length) {
        return `${report.errors.length} error${report.errors.length === 1 ? '' : 's'}: ${report.errors[0]}`;
    }
    return layout && report.layout.length ? `content does not fit: ${report.layout[0]}` : undefined;
}

/** The message that sends the agent back to fix a page, or undefined when the page works. */
export function pageFeedback(file: string, report: PageReport, layout = false): string | undefined {
    if (!pageProblem(report, layout)) {
        return undefined;
    }
    const broken = isBlank(report) || report.errors.length > 0;
    return [
        `Not done yet: ${broken ? 'the page does not work' : 'part of the page does not fit'}. ${describeReport(file, report)}`,
        isBlank(report) ? 'The page is blank: nothing was drawn.' : '',
        broken
            ? 'Find the cause of each error at the file and line named, fix it, and load the page again with check_page before you finish.'
            : 'Fix the layout so nothing is cut off or scrolls sideways (or, if it is meant to, say so), then check again with check_page.',
    ]
        .filter(Boolean)
        .join('\n');
}

/** The agent's own way to load a page and read its errors, mid-task. */
export function checkPageTool(previews: PagePreviews): Tool<{ path: string; script?: string }> {
    return {
        name: 'check_page',
        description:
            'Load a web page from the project in a real browser (hidden) and get what went wrong: uncaught errors and console errors with file and line, files that failed to load, content that is cut off or wider than the window, and the text the page shows after its scripts ran. With `script`, also act on the page like a user and see what happened: click the main controls, then return what changed. Use it after writing or changing a plain HTML page, before you call the work done: once to load it, and once with a script that uses each main feature and returns the values that prove it works. For an app with a dev server, start the server and use fetch_url instead.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'The HTML file, relative to the project root, e.g. my-game/index.html' },
                script: {
                    type: 'string',
                    description:
                        "Optional JavaScript run in the page after it loads, as the body of an async function. Use the DOM like a user would and return a value to see it, e.g. \"document.querySelector('#roll').click(); await new Promise(r => setTimeout(r, 1500)); return { dice: document.querySelector('#dice').textContent, position: document.querySelector('#p1').textContent };\". Timers run fast; about 7 seconds of page time are available.",
                },
            },
            required: ['path'],
        },
        kind: 'read',
        label: (args) => `Check ${args.path} in a browser`,
        paths: (args, workspace) => [workspace.resolve(args.path)],
        async prepare(args, ctx) {
            const workspace = ctx.workspace;
            const file = workspace.resolve(args.path);
            const shown = workspace.relative(file);
            if (!workspace.isInside(file) || !/\.html?$/i.test(file)) {
                return toolError(`${shown} is not an HTML file in this project.`);
            }
            if ((await workspace.stat(file))?.type !== 'file') {
                return toolError(`${shown} does not exist.`);
            }
            return {
                run: async () => {
                    const report = await previews.check(workspace.root, file, ctx.signal, args.script?.trim() || undefined);
                    if (!report) {
                        return toolError(
                            'No Chrome, Edge, Brave or Chromium browser was found on this computer, so the page cannot be loaded here. Re-read your code for mistakes instead, and say in your reply that it was not run in a browser.',
                        );
                    }
                    const blank = isBlank(report);
                    return {
                        content: `${describeReport(shown, report)}${blank ? '\nThe page is blank: nothing was drawn.' : ''}`,
                        isError: report.errors.length > 0 || blank || report.scriptError !== undefined,
                        summary: report.errors.length
                            ? `${report.errors.length} error${report.errors.length === 1 ? '' : 's'}`
                            : blank
                              ? 'blank page'
                              : report.scriptError !== undefined
                                ? 'script threw'
                                : report.layout.length
                                  ? 'loads, layout issues'
                                  : 'no errors',
                    };
                },
            };
        },
    };
}
