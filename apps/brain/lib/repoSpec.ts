/**
 * Parsing a repository reference. Shared by the browser form and the server,
 * so both apply exactly the same rules — the server never trusts the client's.
 */

/** GitHub's own rules: owners are alphanumeric with single hyphens; repos add . and _ but are never all dots. */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO = /^(?!\.+$)[A-Za-z0-9_.-]{1,100}$/;
/** Branch and tag names: no "..", no leading "/" or "-", no control characters. */
const REF = /^(?![-/])(?!.*\.\.)[\w./-]{1,200}$/;

export interface RepoSpec {
    owner: string;
    repo: string;
    ref?: string;
}

/** "owner/repo", "github.com/owner/repo", or a full URL, optionally with /tree/<ref>. Undefined if invalid. */
export function parseRepoSpec(input: string): RepoSpec | { error: string } {
    const cleaned = input
        .trim()
        .replace(/^https?:\/\//, '')
        .replace(/^(www\.)?github\.com\//, '')
        .replace(/\.git$/, '')
        .replace(/\/+$/, '');
    const [owner, repo, marker, ...rest] = cleaned.split('/');
    if (!owner || !repo || !OWNER.test(owner) || !REPO.test(repo) || (marker !== undefined && marker !== 'tree')) {
        return { error: 'Enter a GitHub repository as owner/name or its github.com URL.' };
    }
    const ref = marker === 'tree' && rest.length ? rest.join('/') : undefined;
    if (ref !== undefined && !REF.test(ref)) return { error: 'That branch name looks invalid.' };
    return { owner, repo, ...(ref ? { ref } : {}) };
}
