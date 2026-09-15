import { escapeHtml, highlight } from './highlight';

/**
 * Safe Markdown for model output: every piece of text is escaped before any
 * tag is added, only http(s)/mailto links are kept, and raw HTML never passes.
 */

const OPEN = '';
const CLOSE = '';
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const FILE_REF = /^(?:\.{1,2}\/)?(?:[\w@.-]+\/)*[\w@-][\w@.-]*\.[A-Za-z0-9]{1,10}(?::(\d+)(?:[-:]\d+)?)?$/;

export function renderMarkdown(source: string): string {
    return blocks(source.replace(/\r\n?/g, '\n').replace(/[]/g, '').split('\n'));
}

function blocks(lines: string[]): string {
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const fence = FENCE.exec(line);
        if (fence) {
            const body: string[] = [];
            i++;
            while (i < lines.length && !isFenceClose(lines[i], fence[1])) {
                body.push(lines[i]);
                i++;
            }
            i++;
            out.push(codeBlock(body.join('\n'), fence[2]));
            continue;
        }
        if (!line.trim()) {
            i++;
            continue;
        }
        const heading = HEADING.exec(line);
        if (heading) {
            const level = heading[1].length;
            out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
            i++;
            continue;
        }
        if (RULE.test(line)) {
            out.push('<hr>');
            i++;
            continue;
        }
        if (QUOTE.test(line)) {
            const body: string[] = [];
            while (i < lines.length && QUOTE.test(lines[i])) {
                body.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
                i++;
            }
            out.push(`<blockquote>${blocks(body)}</blockquote>`);
            continue;
        }
        if (isTable(lines, i)) {
            i = table(lines, i, out);
            continue;
        }
        if (LIST_ITEM.test(line)) {
            i = list(lines, i, out);
            continue;
        }
        const paragraph: string[] = [];
        while (i < lines.length && lines[i].trim() && (paragraph.length === 0 || !startsBlock(lines, i))) {
            paragraph.push(lines[i].trim());
            i++;
        }
        out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    }
    return out.join('');
}

function isFenceClose(line: string, marker: string): boolean {
    const trimmed = line.trim();
    return trimmed.length >= marker.length && trimmed[0] === marker[0] && new RegExp(`^\\${marker[0]}+$`).test(trimmed);
}

function startsBlock(lines: string[], i: number): boolean {
    const line = lines[i];
    return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || LIST_ITEM.test(line) || isTable(lines, i);
}

function isTable(lines: string[], i: number): boolean {
    const next = lines[i + 1];
    return (
        lines[i].includes('|') &&
        next !== undefined &&
        next.includes('-') &&
        TABLE_SEPARATOR.test(next) &&
        (next.includes('|') || lines[i].trim().startsWith('|'))
    );
}

function cells(line: string): string[] {
    let text = line.trim();
    if (text.startsWith('|')) {
        text = text.slice(1);
    }
    if (text.endsWith('|')) {
        text = text.slice(0, -1);
    }
    return text.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function table(lines: string[], start: number, out: string[]): number {
    const head = cells(lines[start]);
    const aligns = cells(lines[start + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'al-center' : c.endsWith(':') ? 'al-right' : ''));
    const rows: string[][] = [];
    let i = start + 2;
    while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(cells(lines[i]));
        i++;
    }
    const cell = (tag: string, text: string, column: number) =>
        `<${tag}${aligns[column] ? ` class="${aligns[column]}"` : ''}>${inline(text)}</${tag}>`;
    out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((c, n) => cell('th', c, n)).join('')}</tr></thead><tbody>${rows
            .map((row) => `<tr>${head.map((_, n) => cell('td', row[n] ?? '', n)).join('')}</tr>`)
            .join('')}</tbody></table></div>`,
    );
    return i;
}

interface ListEntry {
    head: string[];
    rest: string[];
    width: number;
}

function list(lines: string[], start: number, out: string[]): number {
    const first = LIST_ITEM.exec(lines[start])!;
    const indent = first[1].length;
    const ordered = /\d/.test(first[2]);
    const items: ListEntry[] = [];
    let i = start;

    while (i < lines.length) {
        const line = lines[i];
        const lineIndent = line.length - line.trimStart().length;
        const match = LIST_ITEM.exec(line);
        const current = items[items.length - 1];

        if (!line.trim()) {
            let j = i + 1;
            while (j < lines.length && !lines[j].trim()) {
                j++;
            }
            if (j >= lines.length) {
                break;
            }
            const next = LIST_ITEM.exec(lines[j]);
            const nextIndent = lines[j].length - lines[j].trimStart().length;
            if ((next && nextIndent === indent && /\d/.test(next[2]) === ordered) || (nextIndent > indent && current)) {
                current?.rest.push('');
                i = j;
                continue;
            }
            break;
        }
        if (match && lineIndent === indent) {
            if (/\d/.test(match[2]) !== ordered) {
                break;
            }
            items.push({ head: [match[3]], rest: [], width: match[0].length - match[3].length - indent });
            i++;
            continue;
        }
        if (current && lineIndent > indent) {
            const content = line.slice(Math.min(lineIndent, indent + current.width));
            if (current.rest.length || LIST_ITEM.test(content) || FENCE.test(content)) {
                current.rest.push(content);
            } else {
                current.head.push(content.trim());
            }
            i++;
            continue;
        }
        if (current && !match && !current.rest.length && !startsBlock(lines, i)) {
            current.head.push(line.trim());
            i++;
            continue;
        }
        break;
    }

    const tag = ordered ? 'ol' : 'ul';
    const startNumber = ordered ? parseInt(first[2], 10) : 1;
    const html = items
        .map((item) => {
            let headLines = item.head;
            let prefix = '';
            let attrs = '';
            const task = /^\[([ xX])\]\s+/.exec(headLines[0] ?? '');
            if (task) {
                const done = task[1] !== ' ';
                prefix = `<span class="task${done ? ' done' : ''}">${done ? '✓' : '○'}</span>`;
                headLines = [headLines[0].slice(task[0].length), ...headLines.slice(1)];
                attrs = ' class="task-item"';
            }
            const rest = item.rest.join('\n').trim() ? blocks(item.rest) : '';
            return `<li${attrs}>${prefix}${headLines.map(inline).join('<br>')}${rest}</li>`;
        })
        .join('');
    out.push(`<${tag}${ordered && startNumber !== 1 ? ` start="${startNumber}"` : ''}>${html}</${tag}>`);
    return i;
}

function inline(text: string): string {
    const slots: string[] = [];
    const hold = (html: string) => `${OPEN}${slots.push(html) - 1}${CLOSE}`;

    let s = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_m, _ticks: string, code: string) => hold(codeSpan(code.trim())));
    s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, label: string, url: string) => {
        if (/^(https?:|mailto:)/i.test(url)) {
            return hold(`<a href="${escapeHtml(url)}" data-external="1">${emphasis(escapeHtml(label))}</a>`);
        }
        if (FILE_REF.test(url)) {
            return hold(fileRefHtml(url, emphasis(escapeHtml(label))));
        }
        return hold(emphasis(escapeHtml(label)));
    });
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])/g, (_m, before: string, url: string) =>
        before + hold(`<a href="${escapeHtml(url)}" data-external="1">${escapeHtml(url)}</a>`),
    );
    s = emphasis(escapeHtml(s));
    for (let pass = 0; pass < 3 && s.includes(OPEN); pass++) {
        s = s.replace(/(\d+)/g, (_m, index: string) => slots[Number(index)] ?? '');
    }
    return s;
}

function emphasis(html: string): string {
    return html
        .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
        .replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])?\*(?![*\w])/g, (m, before: string, body: string | undefined) => (body === undefined ? m : `${before}<em>${body}</em>`))
        .replace(/(^|[^\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
        .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
        .replace(/[✓✔]️?/g, '<span class="glyph ok">✓</span>')
        .replace(/[✗✘❌]️?/g, '<span class="glyph bad">✗</span>')
        .replace(/⚠️?/g, '<span class="glyph warn">⚠</span>');
}

function codeSpan(code: string): string {
    if (FILE_REF.test(code) && (code.includes('/') || /:\d+/.test(code))) {
        return fileRefHtml(code, `<code>${escapeHtml(code)}</code>`);
    }
    return `<code>${escapeHtml(code)}</code>`;
}

function fileRefHtml(reference: string, label: string): string {
    const line = /:(\d+)(?:[-:]\d+)?$/.exec(reference);
    const path = line ? reference.slice(0, line.index) : reference;
    return `<a class="file-ref" href="#" data-path="${escapeHtml(path)}"${line ? ` data-line="${line[1]}"` : ''}>${label}</a>`;
}

function codeBlock(code: string, lang: string): string {
    return `<div class="code-block"><div class="code-head"><span>${escapeHtml(lang || 'code')}</span><button class="code-copy" type="button">Copy</button></div><pre><code>${highlight(code, lang)}</code></pre></div>`;
}
