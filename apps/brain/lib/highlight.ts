/**
 * A small syntax highlighter: comments, strings, keywords, numbers, function
 * calls and type names, which is most of what makes code readable at a glance.
 * Line-based with block-comment state, so it stays fast on large files and
 * never needs a grammar download. Output is tokens, rendered as React text.
 */

export type TokenKind = 'kw' | 'str' | 'com' | 'num' | 'fn' | 'type' | 'plain';
export interface Token {
    k: TokenKind;
    v: string;
}

const KEYWORDS = new Set(
    (
        'abstract as async await break case catch class const continue debugger declare default defer delete do else enum export extends ' +
        'false finally for from func function get go if implements import in instanceof interface is keyof let match mod module mut namespace new ' +
        'nil null of package private protected pub public readonly return satisfies select set static struct super switch this throw trait true ' +
        'try type typeof undefined use var void where while with yield impl fn loop crate self Self def elif except lambda pass raise not and or ' +
        'global nonlocal assert del None True False val fun when object override data sealed range chan map'
    ).split(' '),
);

const HASH_COMMENTS = new Set(['py', 'rb', 'sh', 'bash', 'zsh', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'dockerfile', 'makefile', 'r', 'pl', 'ps1', 'env', 'gitignore']);
const SLASH_COMMENTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'c', 'h', 'cpp', 'cc', 'hpp', 'cs', 'swift', 'dart', 'php', 'css', 'scss', 'less', 'vue', 'svelte', 'astro', 'prisma', 'graphql', 'proto', 'jsonc']);
const PLAIN = new Set(['md', 'mdx', 'txt', 'rst', 'csv', 'log']);

export function languageOf(path: string): { hash: boolean; slash: boolean; plain: boolean } {
    const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name;
    return { hash: HASH_COMMENTS.has(ext), slash: SLASH_COMMENTS.has(ext), plain: PLAIN.has(ext) };
}

export function highlight(text: string, path: string): Token[][] {
    const lang = languageOf(path);
    const lines = text.split('\n');
    if (lang.plain || text.length > 400_000) return lines.map((v) => [{ k: 'plain', v }]);

    let inBlock = false;
    let inTriple: string | undefined;
    return lines.map((line) => {
        const out: Token[] = [];
        const push = (k: TokenKind, v: string) => {
            if (!v) return;
            const last = out[out.length - 1];
            if (last && last.k === k) last.v += v;
            else out.push({ k, v });
        };
        let i = 0;
        if (inBlock) {
            const end = line.indexOf('*/');
            if (end === -1) return [{ k: 'com', v: line }];
            push('com', line.slice(0, end + 2));
            i = end + 2;
            inBlock = false;
        }
        if (inTriple) {
            const end = line.indexOf(inTriple);
            if (end === -1) return [{ k: 'str', v: line }];
            push('str', line.slice(0, end + 3));
            i = end + 3;
            inTriple = undefined;
        }
        while (i < line.length) {
            const ch = line[i]!;
            const rest = line.slice(i);
            if ((lang.slash && rest.startsWith('//')) || (lang.hash && ch === '#')) {
                push('com', rest);
                break;
            }
            if (lang.slash && rest.startsWith('/*')) {
                const end = line.indexOf('*/', i + 2);
                if (end === -1) {
                    push('com', rest);
                    inBlock = true;
                    break;
                }
                push('com', line.slice(i, end + 2));
                i = end + 2;
                continue;
            }
            if (lang.hash && (rest.startsWith('"""') || rest.startsWith("'''"))) {
                const quote = rest.slice(0, 3);
                const end = line.indexOf(quote, i + 3);
                if (end === -1) {
                    push('str', rest);
                    inTriple = quote;
                    break;
                }
                push('str', line.slice(i, end + 3));
                i = end + 3;
                continue;
            }
            if (ch === '"' || ch === "'" || ch === '`') {
                let j = i + 1;
                while (j < line.length && line[j] !== ch) j += line[j] === '\\' ? 2 : 1;
                push('str', line.slice(i, j + 1));
                i = j + 1;
                continue;
            }
            if (/[0-9]/.test(ch) && !/[\w$]/.test(line[i - 1] ?? '')) {
                const num = /^(0x[\da-fA-F_]+|\d[\d_]*(\.\d+)?([eE][+-]?\d+)?)[a-zA-Z]*/.exec(rest)?.[0] ?? ch;
                push('num', num);
                i += num.length;
                continue;
            }
            if (/[A-Za-z_$]/.test(ch)) {
                const word = /^[A-Za-z_$][\w$]*/.exec(rest)![0];
                const after = line.slice(i + word.length).trimStart();
                const kind: TokenKind = KEYWORDS.has(word) ? 'kw' : after.startsWith('(') ? 'fn' : /^[A-Z]/.test(word) ? 'type' : 'plain';
                push(kind, word);
                i += word.length;
                continue;
            }
            push('plain', ch);
            i++;
        }
        return out.length ? out : [{ k: 'plain', v: '' }];
    });
}
