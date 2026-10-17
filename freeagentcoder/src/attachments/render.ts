import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * A document as its reader sees it: a .pptx or .docx turned into a PDF, so a
 * vision model can look at the real pages (cut-off text, crowding, contrast,
 * pictures) instead of reading its XML. Uses the document's own PDF copy when
 * the build made one, else PowerPoint or Word when installed (Windows), else
 * LibreOffice. Renders go to the temp folder, never into the user's project.
 */
export type Rendered = { pdf: string; via: string } | { error: string };

const RENDER_TIMEOUT_MS = 120_000;

function run(file: string, args: string[], signal?: AbortSignal): Promise<{ ok: boolean; output: string }> {
    return new Promise((resolve) => {
        execFile(file, args, { timeout: RENDER_TIMEOUT_MS, windowsHide: true, signal, maxBuffer: 4_000_000 }, (error, stdout, stderr) => {
            resolve({ ok: !error, output: `${stdout}${stderr}${error ? `\n${error.message}` : ''}`.trim() });
        });
    });
}

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * PowerShell that converts with Office. When the app was already open (the
 * user's own presentations in it), it is left open: only an instance started
 * here is closed.
 */
function officeScript(ext: string, input: string, output: string): string | undefined {
    if (ext === '.pptx' || ext === '.ppt') {
        return [
            "$ErrorActionPreference = 'Stop'",
            '$running = Get-Process POWERPNT -ErrorAction SilentlyContinue',
            '$app = New-Object -ComObject PowerPoint.Application',
            'try {',
            `  $deck = $app.Presentations.Open(${quote(input)}, -1, 0, 0)`,
            `  $deck.SaveAs(${quote(output)}, 32)`,
            '  $deck.Close()',
            '} finally { if (-not $running) { $app.Quit() } }',
        ].join('\n');
    }
    if (ext === '.docx' || ext === '.doc') {
        return [
            "$ErrorActionPreference = 'Stop'",
            '$running = Get-Process WINWORD -ErrorAction SilentlyContinue',
            '$app = New-Object -ComObject Word.Application',
            '$app.Visible = $false',
            'try {',
            `  $doc = $app.Documents.Open(${quote(input)}, $false, $true)`,
            `  $doc.ExportAsFixedFormat(${quote(output)}, 17)`,
            '  $doc.Close(0)',
            '} finally { if (-not $running) { $app.Quit() } }',
        ].join('\n');
    }
    return undefined;
}

function libreOffice(): string | undefined {
    const candidates =
        process.platform === 'win32'
            ? [
                  path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'LibreOffice', 'program', 'soffice.exe'),
                  path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'LibreOffice', 'program', 'soffice.exe'),
              ]
            : ['/Applications/LibreOffice.app/Contents/MacOS/soffice', '/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/local/bin/soffice', '/snap/bin/libreoffice'];
    return candidates.find((c) => existsSync(c));
}

export async function renderToPdf(file: string, signal?: AbortSignal): Promise<Rendered> {
    const ext = path.extname(file).toLowerCase();
    if (ext === '.pdf') {
        return { pdf: file, via: 'the PDF itself' };
    }
    const source = await stat(file).catch(() => undefined);
    if (!source) {
        return { error: `${file} does not exist.` };
    }
    // The PDF copy the build script made, when it is at least as new as the document.
    const sibling = file.slice(0, -ext.length) + '.pdf';
    const copy = await stat(sibling).catch(() => undefined);
    if (copy && copy.mtimeMs >= source.mtimeMs - 1_000) {
        return { pdf: sibling, via: 'its PDF copy' };
    }

    const key = createHash('sha1').update(`${file}:${source.mtimeMs}`).digest('hex').slice(0, 16);
    const dir = path.join(os.tmpdir(), 'freeagentcoder-render', key);
    await mkdir(dir, { recursive: true });
    const output = path.join(dir, `${path.basename(file, ext)}.pdf`);
    if (existsSync(output)) {
        return { pdf: output, via: 'an earlier render' };
    }

    const problems: string[] = [];
    // LibreOffice first: it needs no licence and never touches a PowerPoint or Word window the user has open.
    const soffice = libreOffice();
    if (soffice) {
        const profile = `file:///${path.join(os.tmpdir(), 'freeagentcoder-render', 'lo-profile').replace(/\\/g, '/')}`;
        const result = await run(soffice, [`-env:UserInstallation=${profile}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, path.resolve(file)], signal);
        const made = (await readdir(dir).catch(() => [] as string[])).find((f) => f.toLowerCase().endsWith('.pdf'));
        if (made) {
            return { pdf: path.join(dir, made), via: 'LibreOffice' };
        }
        problems.push(`LibreOffice: ${result.output.split('\n')[0]?.slice(0, 160) || 'no output'}`);
    }
    if (process.platform === 'win32') {
        const script = officeScript(ext, path.resolve(file), output);
        if (script) {
            const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], signal);
            if (existsSync(output)) {
                return { pdf: output, via: ext.startsWith('.ppt') ? 'PowerPoint' : 'Word' };
            }
            const busy = /0x80048240|RPC_E_CALL_REJECTED|0x80010001/i.test(result.output);
            problems.push(
                busy
                    ? `${ext.startsWith('.ppt') ? 'PowerPoint' : 'Word'} is open on this computer and refused (it may be showing a dialog, such as an activation notice)`
                    : `Office: ${result.output.split('\n')[0]?.slice(0, 160) || 'not available'}`,
            );
        }
    }
    return {
        error: `No way to render it on this computer (${problems.length ? problems.join('; ') : 'neither LibreOffice, PowerPoint nor Word was found'}). Tell the user that installing the free LibreOffice (winget install TheDocumentFoundation.LibreOffice) lets FreeAgentCoder make the PDF and check how every page looks.`,
    };
}
