import { promises as fs } from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';

/**
 * Serves one folder of plain web files on this computer only, so a page the
 * agent wrote can be shown beside the code. A page opened straight from the
 * disk cannot load ES modules or fetch its own files; over http it can.
 *
 * Bound to 127.0.0.1 on a free port, read-only, and nothing outside the
 * folder is ever served. Hidden files (.env, .git) are never served, and a
 * request must be addressed to this computer by name, so a web page elsewhere
 * cannot reach the folder by pointing its own domain at 127.0.0.1.
 */

const TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.txt': 'text/plain; charset=utf-8',
    '.wasm': 'application/wasm',
};

export interface StaticServer {
    /** The folder being served. */
    root: string;
    /** `http://127.0.0.1:<port>`, with no trailing slash. */
    origin: string;
    close(): void;
}

/** The file a request path names inside the root, or undefined when it points outside it. */
export function resolveInside(root: string, requestPath: string): string | undefined {
    let decoded: string;
    try {
        decoded = decodeURIComponent(requestPath.split('?')[0]!.split('#')[0]!);
    } catch {
        return undefined;
    }
    if (decoded.includes('\0')) {
        return undefined;
    }
    const file = path.resolve(root, `.${path.posix.normalize(`/${decoded.replace(/\\/g, '/')}`)}`);
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return undefined;
    }
    return relative.split(path.sep).some((part) => part.startsWith('.') && part !== '.') ? undefined : file;
}

/** `inject`: a script added to the end of every HTML page served, for a check run. Never set on the server a person looks at. */
export function startStaticServer(folder: string, options: { inject?: string } = {}): Promise<StaticServer> {
    const root = path.resolve(folder);
    const server = http.createServer((request, response) => {
        void (async () => {
            const send = (status: number, body: string | Buffer, type = 'text/plain; charset=utf-8') => {
                // Always the latest file: the agent may have just rewritten it.
                response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
                response.end(request.method === 'HEAD' ? undefined : body);
            };
            if (request.method !== 'GET' && request.method !== 'HEAD') {
                return send(405, 'Only GET is served.');
            }
            if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(request.headers.host ?? '')) {
                return send(403, 'This preview answers only on this computer.');
            }
            let file = resolveInside(root, request.url ?? '/');
            if (!file) {
                return send(403, 'Outside the previewed folder.');
            }
            try {
                if ((await fs.stat(file)).isDirectory()) {
                    file = path.join(file, 'index.html');
                }
                const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
                const content = await fs.readFile(file);
                if (options.inject && type.startsWith('text/html')) {
                    const html = content.toString('utf8');
                    // A closing tag inside the script would end it early.
                    const tag = `<script>${options.inject.replace(/<\/script/gi, '<\\/script')}</script>`;
                    const end = html.toLowerCase().lastIndexOf('</body>');
                    return send(200, end === -1 ? html + tag : html.slice(0, end) + tag + html.slice(end), type);
                }
                send(200, content, type);
            } catch {
                send(404, 'Not found.');
            }
        })();
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as AddressInfo;
            resolve({
                root,
                origin: `http://127.0.0.1:${port}`,
                close: () => {
                    server.close();
                    server.closeAllConnections();
                },
            });
        });
    });
}
