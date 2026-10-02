'use client';

import { useState } from 'react';

/**
 * Pushes the project to a new GitHub repository on the user's own account,
 * straight from this browser to GitHub's API: our server never sees the code
 * or the token. One commit with every file. The token stays in this browser.
 */

const TOKEN = 'fyxable.githubToken';
const API = 'https://api.github.com';

async function gh<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    const body = (await response.json().catch(() => ({}))) as T & { message?: string };
    if (!response.ok) throw new Error(body.message ? `GitHub: ${body.message}` : `GitHub answered ${response.status}`);
    return body;
}

export async function pushToGithub(token: string, name: string, isPrivate: boolean, files: Record<string, string>, message: string): Promise<string> {
    const repo = await gh<{ full_name: string; default_branch: string; html_url: string }>(token, '/user/repos', {
        method: 'POST',
        body: JSON.stringify({ name, private: isPrivate, auto_init: true, description: 'Built with Fyxable, by Free Agent Coder' }),
    });
    const ref = await gh<{ object: { sha: string } }>(token, `/repos/${repo.full_name}/git/ref/heads/${repo.default_branch}`);
    const base = await gh<{ tree: { sha: string } }>(token, `/repos/${repo.full_name}/git/commits/${ref.object.sha}`);
    const tree = await gh<{ sha: string }>(token, `/repos/${repo.full_name}/git/trees`, {
        method: 'POST',
        body: JSON.stringify({ base_tree: base.tree.sha, tree: Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })) }),
    });
    const commit = await gh<{ sha: string }>(token, `/repos/${repo.full_name}/git/commits`, {
        method: 'POST',
        body: JSON.stringify({ message, tree: tree.sha, parents: [ref.object.sha] }),
    });
    await gh(token, `/repos/${repo.full_name}/git/refs/heads/${repo.default_branch}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
    return repo.html_url;
}

export function GithubExport({ files, name, onClose }: { files: Record<string, string>; name: string; onClose: () => void }) {
    const saved = (() => {
        try {
            return window.localStorage.getItem(TOKEN) ?? '';
        } catch {
            return '';
        }
    })();
    const [token, setToken] = useState(saved);
    const [repo, setRepo] = useState(name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'my-fyxable-app');
    const [isPrivate, setPrivate] = useState(true);
    const [state, setState] = useState<{ busy?: boolean; error?: string; url?: string }>({});

    const go = async () => {
        if (!token.trim() || !repo.trim()) return setState({ error: 'Paste a GitHub token and choose a name.' });
        setState({ busy: true });
        try {
            try {
                window.localStorage.setItem(TOKEN, token.trim());
            } catch {
                // Storage blocked: the token is used for this push only.
            }
            const url = await pushToGithub(token.trim(), repo.trim(), isPrivate, files, 'First version, built with Fyxable');
            setState({ url });
        } catch (error) {
            setState({ error: (error as Error).message });
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-label="Export to GitHub">
            <div className="w-full max-w-md rounded-xl border border-line-strong bg-panel p-5 text-fg shadow-2xl">
                <div className="flex items-center justify-between">
                    <h2 className="text-[16px] font-semibold">Export to GitHub</h2>
                    <button type="button" onClick={onClose} className="text-muted hover:text-fg" aria-label="Close">
                        ✕
                    </button>
                </div>
                {state.url ? (
                    <div className="mt-4 space-y-3 text-[14px]">
                        <p className="text-ok">Pushed. Your project is on GitHub.</p>
                        <a href={state.url} target="_blank" rel="noreferrer noopener" className="block break-all text-accent underline">
                            {state.url}
                        </a>
                        <p className="text-[13px] text-muted">Keep building it in VS Code with the free Free Agent Coder extension, on the same keys.</p>
                    </div>
                ) : (
                    <div className="mt-4 space-y-3 text-[13px]">
                        <p className="text-muted">
                            Creates a new repository on your account with every file in one commit. Goes straight from this browser to GitHub; we never see your code or
                            token.
                        </p>
                        <label className="block">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Repository name</span>
                            <input value={repo} onChange={(e) => setRepo(e.target.value)} className="mt-1 h-10 w-full rounded-md border border-line-strong bg-bg px-3 text-fg" />
                        </label>
                        <label className="flex items-center gap-2 text-muted">
                            <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} className="size-4" /> Private repository
                        </label>
                        <label className="block">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">GitHub token</span>
                            <input
                                type="password"
                                value={token}
                                onChange={(e) => setToken(e.target.value)}
                                placeholder="github_pat_…"
                                autoComplete="off"
                                className="mt-1 h-10 w-full rounded-md border border-line-strong bg-bg px-3 font-mono text-fg"
                            />
                            <span className="mt-1 block text-[12px] text-faint">
                                <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer noopener" className="text-accent underline">
                                    Make a token
                                </a>{' '}
                                with &ldquo;All repositories&rdquo; access and Administration and Contents set to read and write. It stays in this browser.
                            </span>
                        </label>
                        {state.error && <p className="text-bad">{state.error}</p>}
                        <button type="button" onClick={go} disabled={state.busy} className="h-10 w-full rounded-md bg-accent text-[14px] font-semibold text-accent-fg disabled:opacity-60">
                            {state.busy ? 'Pushing…' : 'Create repository and push'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
