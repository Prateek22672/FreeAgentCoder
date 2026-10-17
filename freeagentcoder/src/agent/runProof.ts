/**
 * Evidence before "here is your link". In real chats the agent told the user
 * to install Flutter six times, gave addresses nothing was serving, wrote
 * "fetch_url returns the app" without calling it, and copied a stale
 * 127.0.0.1 link into every reply while the server listened on [::1]. So the
 * link comes from the server's own output and is opened by the editor, the
 * user is told when a reply is not verified, and an app that throws is not
 * called working.
 */

const ADDRESS = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d+)[^\s"'<>)\]`,]*/gi;

/** "You'll need to install Flutter first", "run it yourself": the work handed back to the user. */
const HANDOFF =
    /\b(?:you(?:'ll| will)?\s+(?:need|have)\s+to\s+(?:install|download|run|set\s*up|start)|(?:please|then|first,?)\s+(?:install|download)|run\s+(?:it|this|the\s+(?:app|project))\s+yourself|to\s+run\s+it\s+yourself|install\s+[\w.-]+(?:\s+[\w.-]+)?\s+first|once\s+[\w.-]+\s+is\s+installed)\b/i;
/** "The app is now running", "it is live": a claim that needs a server behind it. */
const RUNNING_CLAIM = /\b(?:is|are|now)\s+(?:now\s+)?(?:running|live|up and running|being served|serving)\b/i;

const portsIn = (text: string) => [...text.matchAll(ADDRESS)].map((m) => m[1]!);
const asUrl = (address: string) =>
    (/^https?:\/\//i.test(address) ? address : `http://${address}`).replace(/[.;:]+$/, '').replace('0.0.0.0', 'localhost').replace(/\[::1?\]/, 'localhost');

/** The local addresses a text gives, as URLs. */
export function addressesIn(text: string): string[] {
    return [...new Set([...text.matchAll(ADDRESS)].map((m) => asUrl(m[0])))];
}

/** Where a dev server says the app is: "is being served at", "Local:", "running at", "listening on". */
const APP_LINE = /(?:is being served at|Local:|running (?:at|on)|listening (?:at|on)|available at|Serving HTTP on [^(\n]*\()\s*(https?:\/\/[^\s"'<>)\]]+)/i;
/** Addresses that are not the app: Flutter's VM service and DevTools, debugger sockets. */
const NOT_THE_APP = /vm[\s-]?service|devtools|debug service|debugger|\bws:\/\/|\/[A-Za-z0-9_-]{6,}=\/?(?:\s|$)/i;
const COMMAND_PORT = /(?:--(?:web-)?port[=\s]+|--server\.port[=\s]+|\s-p\s+|\bPORT=|\bhttp\.server\s+)(\d{2,5})\b/i;

/**
 * The address the user should open for a running app: the one its server
 * printed for the app, else the port its command asked for. Never the debug
 * service Flutter prints beside it.
 */
export function appAddress(output: string, command = ''): string | undefined {
    for (const line of output.split('\n')) {
        if (NOT_THE_APP.test(line)) {
            continue;
        }
        const url = APP_LINE.exec(line)?.[1];
        if (url && addressesIn(url).length) {
            return asUrl(url).replace(/\/$/, '');
        }
    }
    const port = COMMAND_PORT.exec(command)?.[1];
    return port ? `http://localhost:${port}` : undefined;
}

/**
 * Whether a server has not said yet where it is served: a Flutter web build
 * takes one to two minutes, and a request before then hangs until it is done.
 * Checking the link in that time says "not reachable" about an app that is
 * about to work.
 */
export function stillStarting(output: string, command = ''): boolean {
    const printed = output.split('\n').some((line) => !NOT_THE_APP.test(line) && APP_LINE.test(line));
    if (printed) {
        return false;
    }
    const tail = output.trim().split('\n').slice(-3).join('\n');
    return /\bflutter(?:\.bat)?["']?\s+run\b/i.test(command) || /\b(?:Launching|Compiling|Building|Waiting for connection|Starting)\b[^\n]*$/i.test(tail);
}

/**
 * Errors the running app printed: Flutter's "EXCEPTION CAUGHT BY" reports
 * (a red screen in the browser), compile errors, uncaught exceptions.
 */
export function appErrors(output: string): string[] {
    const lines = output.split('\n').map((l) => l.trim());
    const found: string[] = [];
    lines.forEach((line, i) => {
        if (/EXCEPTION CAUGHT BY/i.test(line)) {
            const what = lines.slice(i + 1, i + 6).filter(Boolean).filter((l) => !/^═+$/.test(l));
            found.push(what.slice(0, 2).join(' ').slice(0, 300));
        } else if (/^Another exception was thrown:/i.test(line) || /\.dart:\d+:\d+: Error: /.test(line) || /\bUncaught (?:\w*Error|exception)\b/i.test(line)) {
            found.push(line.slice(0, 300));
        }
    });
    return [...new Set(found)].slice(0, 5);
}

/** Opens an address; true when a server answered, otherwise why not. */
export type Probe = (url: string) => Promise<true | string>;

/** A real request, as the user's browser would make it. */
export const httpProbe: Probe = async (url) => {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(8_000), redirect: 'manual' });
        return response.status < 500 ? true : `it answered ${response.status}`;
    } catch (error) {
        const cause = (error as { cause?: { code?: string } }).cause?.code;
        return cause === 'ECONNREFUSED' ? 'the connection was refused' : cause ?? (error instanceof Error ? error.message : String(error));
    }
};

/** What sends the agent back (`feedback`), and the line the user sees instead of trusting the reply (`notice`). */
export interface Verdict {
    feedback: string;
    notice: string;
}

const FINAL_REPLY =
    'In your reply do not write addresses, ports, process ids or a "Verification" section: the editor shows the working link as a button. Say in one or two lines that it is running, or what stops it.';

/**
 * Whether the last reply on a run task is backed by a server that answers.
 * `serving` holds the app addresses of the background processes still running.
 */
export async function runProof(reply: string, serving: string[], probe: Probe = httpProbe): Promise<Verdict | undefined> {
    const live = new Set(serving.flatMap(portsIn));
    const claimed = addressesIn(reply);
    const start = 'Start the project with run_command background=true and read its output with the process tool until it prints where it is served.';
    if (claimed.length && !portsIn(reply).some((port) => live.has(port))) {
        return {
            feedback: `You gave the user ${claimed[0]}, but nothing is serving it${live.size ? `; the app is served at ${serving[0]}` : ': no background process is running'}. ${start} ${FINAL_REPLY}`,
            notice: `Not verified: nothing is serving ${claimed[0]}${live.size ? ` (the app is at ${serving[0]})` : ''}. Ignore that link; still working.`,
        };
    }
    for (const url of claimed.slice(0, 3)) {
        const answer = await probe(url);
        if (answer !== true) {
            const printed = serving.find((s) => portsIn(s).some((p) => portsIn(url).includes(p)));
            return {
                feedback: [
                    `The editor opened ${url} and ${answer}, so the user would see "This site can't be reached".`,
                    printed && printed !== url ? `The app is served at ${printed}.` : '',
                    'On Windows a server bound to localhost can listen on IPv6 only ([::1]), so 127.0.0.1 is refused. Never say a page loads without having opened it.',
                    FINAL_REPLY,
                ]
                    .filter(Boolean)
                    .join(' '),
                notice: `Not verified: FreeAgentCoder opened ${url} and ${answer}${printed && printed !== url ? `; the app is at ${printed}` : ''}. Ignore that link; still working.`,
            };
        }
    }
    if (!live.size && HANDOFF.test(reply)) {
        return {
            feedback: [
                'Nothing is running yet, and your reply asks the user to do the work. Do it yourself:',
                'find or install the toolchain (from anything the user supplied, such as a zip), start the project in the background and wait until it is served.',
                'Only if a step truly needs the user (admin rights, a licence prompt, a device to plug in), say exactly that one step and why, after doing everything else.',
            ].join(' '),
            notice: 'Not accepted: that reply hands the work back to you. Still working on it.',
        };
    }
    if (!live.size && RUNNING_CLAIM.test(reply) && !/\b(?:not|isn't|cannot|can't|won't)\b[^.]{0,30}\brunning\b/i.test(reply)) {
        return { feedback: `Nothing is running: no background process is serving the app. ${start} ${FINAL_REPLY}`, notice: 'Not verified: nothing is running yet. Still working.' };
    }
    return undefined;
}
