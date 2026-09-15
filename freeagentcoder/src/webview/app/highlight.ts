export function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

type Rule = [token: string, pattern: RegExp];

interface Family {
    rules: Rule[];
    flags: string;
    compiled?: RegExp;
}

function words(list: string): RegExp {
    return new RegExp(`\\b(?:${list.trim().split(/\s+/).join('|')})\\b`);
}

const SLASH_COMMENT = /\/\/[^\n]*|\/\*[\s\S]*?\*\//;
const DQ = /"(?:\\.|[^"\\\n])*"/;
const SQ = /'(?:\\.|[^'\\\n])*'/;
const BT = /`(?:\\[\s\S]|[^\\`])*`/;
const NUM = /\b(?:0x[\da-fA-F]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)\b/;
const CALL = /\b[A-Za-z_$][\w$]*(?=\s*\()/;
const TYPE = /\b[A-Z][A-Za-z0-9_]*\b/;

const C_KEYWORDS = words(`abstract as async await break case catch class const continue debugger default delete do else enum export extends
    false finally for from function if implements import in instanceof interface let new null of override package private protected
    public readonly return satisfies static super switch this throw true try type typeof undefined var void while with yield
    fn mut pub impl struct trait use mod match loop move ref where crate dyn func go defer select range chan nil bool int
    float double char long short unsigned template namespace using virtual`);
const PY_KEYWORDS = words(`and as assert async await break class continue def del elif else except False finally for from global if import
    in is lambda None nonlocal not or pass raise return True try while with yield self match case begin end require module`);
const SH_KEYWORDS = words(`if then else elif fi for while do done case esac function in return export local cd exit set unset source alias
    sudo npm npx pnpm yarn bun git node python pip docker cargo go`);

const FAMILIES: Record<string, Family> = {
    c: {
        flags: 'g',
        rules: [['comment', SLASH_COMMENT], ['string', BT], ['string', DQ], ['string', SQ], ['keyword', C_KEYWORDS], ['number', NUM], ['function', CALL], ['type', TYPE]],
    },
    python: {
        flags: 'g',
        rules: [
            ['comment', /#[^\n]*/],
            ['string', /"""[\s\S]*?"""|'''[\s\S]*?'''/],
            ['string', DQ],
            ['string', SQ],
            ['keyword', PY_KEYWORDS],
            ['function', /@[\w.]+/],
            ['number', NUM],
            ['function', CALL],
            ['type', TYPE],
        ],
    },
    shell: {
        flags: 'gm',
        rules: [
            ['comment', /(?:^|[ \t])#[^\n]*/],
            ['string', DQ],
            ['string', SQ],
            ['property', /\$\{?[\w:]+\}?/],
            ['keyword', SH_KEYWORDS],
            ['flag', /(?<=\s)--?[A-Za-z][\w-]*/],
            ['number', NUM],
        ],
    },
    json: {
        flags: 'g',
        rules: [['property', /"(?:\\.|[^"\\\n])*"(?=\s*:)/], ['string', DQ], ['number', /-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/], ['keyword', words('true false null')]],
    },
    yaml: {
        flags: 'gm',
        rules: [['comment', /#[^\n]*/], ['property', /^[ \t-]*[\w.-]+(?=\s*[:=])/], ['string', DQ], ['string', SQ], ['keyword', words('true false null yes no on off')], ['number', NUM]],
    },
    markup: {
        flags: 'g',
        rules: [['comment', /<!--[\s\S]*?-->/], ['keyword', /<\/?[A-Za-z][\w:.-]*|\/?>/], ['property', /\b[\w:@.-]+(?==)/], ['string', DQ], ['string', SQ]],
    },
    css: {
        flags: 'g',
        rules: [
            ['comment', /\/\*[\s\S]*?\*\//],
            ['string', DQ],
            ['string', SQ],
            ['keyword', /@[\w-]+/],
            ['property', /[\w-]+(?=\s*:[^:])/],
            ['type', /[.#][A-Za-z_][\w-]*/],
            ['number', /-?\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|ms|s|fr|deg)?\b/],
        ],
    },
    sql: {
        flags: 'gi',
        rules: [
            ['comment', /--[^\n]*/],
            ['string', SQ],
            ['keyword', words(`select from where insert into values update set delete create table alter drop index primary key foreign references
                join left right inner outer on group by order having limit offset as and or not null default unique exists if returning with
                union distinct case when then else end begin commit`)],
            ['number', NUM],
        ],
    },
    diff: {
        flags: 'gm',
        rules: [['inserted', /^\+[^\n]*/], ['deleted', /^-[^\n]*/], ['meta', /^@@[^\n]*/]],
    },
};

const ALIASES: Record<string, string> = {
    js: 'c', jsx: 'c', mjs: 'c', cjs: 'c', ts: 'c', tsx: 'c', mts: 'c', javascript: 'c', typescript: 'c', java: 'c', c: 'c', h: 'c',
    cpp: 'c', 'c++': 'c', cs: 'c', csharp: 'c', go: 'c', golang: 'c', rust: 'c', rs: 'c', kotlin: 'c', kt: 'c', swift: 'c', php: 'c',
    dart: 'c', scala: 'c', prisma: 'c', graphql: 'c',
    py: 'python', python: 'python', rb: 'python', ruby: 'python',
    sh: 'shell', bash: 'shell', zsh: 'shell', shell: 'shell', console: 'shell', terminal: 'shell', powershell: 'shell', ps1: 'shell',
    pwsh: 'shell', cmd: 'shell', bat: 'shell', dockerfile: 'shell', docker: 'shell', makefile: 'shell',
    json: 'json', jsonc: 'json', json5: 'json',
    yaml: 'yaml', yml: 'yaml', toml: 'yaml', ini: 'yaml', env: 'yaml', dotenv: 'yaml', properties: 'yaml',
    html: 'markup', xml: 'markup', svg: 'markup', vue: 'markup', svelte: 'markup', astro: 'markup',
    css: 'css', scss: 'css', sass: 'css', less: 'css', postcss: 'css',
    sql: 'sql', postgres: 'sql', postgresql: 'sql', mysql: 'sql', sqlite: 'sql',
    diff: 'diff', patch: 'diff',
};

export function highlight(code: string, lang: string): string {
    const family = FAMILIES[ALIASES[lang.toLowerCase()] ?? ''];
    if (!family || code.length > 60_000) {
        return escapeHtml(code);
    }
    const pattern = (family.compiled ??= new RegExp(family.rules.map(([, r]) => `(${r.source})`).join('|'), family.flags));
    pattern.lastIndex = 0;
    let out = '';
    let last = 0;
    for (let match = pattern.exec(code); match; match = pattern.exec(code)) {
        if (!match[0]) {
            pattern.lastIndex++;
            continue;
        }
        const group = match.findIndex((value, index) => index > 0 && value !== undefined);
        out += `${escapeHtml(code.slice(last, match.index))}<span class="tok-${family.rules[group - 1][0]}">${escapeHtml(match[0])}</span>`;
        last = match.index + match[0].length;
    }
    return out + escapeHtml(code.slice(last));
}
