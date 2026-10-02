/**
 * Fyx on the web: the chores Fyxable can do without a model. Like Fyx in the
 * extension, a request is matched to an action only when it is plainly one
 * chore; anything with more to it goes to the agent. Zero tokens, instant.
 */

export type WebFyx =
    | { kind: 'run' }
    | { kind: 'stop' }
    | { kind: 'zip' }
    | { kind: 'github' }
    | { kind: 'add'; packages: string[]; dev: boolean }
    | { kind: 'delete'; path: string };

const NPM_NAME = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(@[\w.^~<>=*-]+)?$/i;
/** Words in "add a login page" that are not packages: then it is a feature, for the agent. */
const NOT_PACKAGES = /^(a|an|some|new|more|my|the|this|page|pages|button|component|section|feature|form|function|file|support|test|tests|style|styles|login|signup|footer|header|navbar|menu|link|image|text)$/i;

/** Words that mean the request asks for more than the chore, so the agent should take it. */
const MORE = /\b(and then|then|after that|also|but|fix|why|how|explain|error|bug|change|make|build|create|write|add a|use it|with it)\b/i;

export function planWebFyx(request: string, files: Record<string, string>): WebFyx | undefined {
    const text = request.trim().replace(/[.!]+$/, '');
    if (!text || text.length > 120) return undefined;
    const lower = text.toLowerCase();

    if (/^(please )?(run|start|preview|launch|open|serve)( (it|the (app|project|site|website|server)|this|my (app|project|site)))?( (now|locally|here))?$/.test(lower)) return { kind: 'run' };
    if (/^(please )?(stop|kill|shut down)( (it|the (app|project|server|preview)))?$/.test(lower)) return { kind: 'stop' };
    if (/^(please )?(download|zip|export)( (it|the project|this|the (app|code|files)|everything))?( as (a )?zip)?$/.test(lower)) return { kind: 'zip' };
    if (/^(please )?(push|export|upload|save|put)( (it|the project|this|the code))? (to|on) github$/.test(lower)) return { kind: 'github' };

    const add = /^(?:please )?(?:npm (?:install|i|add)|install|add)(?: the)?(?: (dev(?:elopment)?) (?:dependenc(?:y|ies)|packages?))?(?: packages?)? (.+?)(?: (?:as|to) (?:a )?(dev(?:elopment)? )?dependenc(?:y|ies))?$/i.exec(text);
    if (add && !MORE.test(add[2]!)) {
        const packages = add[2]!.split(/[\s,]+|\band\b/).map((p) => p.trim()).filter((p) => p && p !== '-D' && p !== '--save-dev');
        if (packages.length && packages.length <= 6 && packages.every((p) => NPM_NAME.test(p) && !NOT_PACKAGES.test(p)) && 'package.json' in files) {
            return { kind: 'add', packages, dev: Boolean(add[1] || add[3]) || /(^|\s)(-D|--save-dev)(\s|$)/.test(add[2]!) };
        }
    }

    const del = /^(?:please )?(?:delete|remove|rm)(?: the)?(?: file)? ([\w@.\-/ ]+?)(?: file)?$/i.exec(text);
    if (del && del[1]! in files) return { kind: 'delete', path: del[1]! };

    return undefined;
}

/** package.json with the packages added at "latest", or undefined if it cannot be read. */
export function withPackages(packageJson: string, packages: string[], dev: boolean): string | undefined {
    try {
        const pkg = JSON.parse(packageJson) as Record<string, unknown>;
        const field = dev ? 'devDependencies' : 'dependencies';
        const deps = { ...((pkg[field] as Record<string, string> | undefined) ?? {}) };
        for (const spec of packages) {
            const at = spec.lastIndexOf('@');
            const [name, version] = at > 0 ? [spec.slice(0, at), spec.slice(at + 1)] : [spec, 'latest'];
            deps[name] = version || 'latest';
        }
        pkg[field] = Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)));
        return `${JSON.stringify(pkg, null, 2)}\n`;
    } catch {
        return undefined;
    }
}
