'use client';

import { useState } from 'react';
import { parseRepoSpec } from '@/lib/repoSpec';

/**
 * With a task, this goes straight to the plan for that task; without one, to
 * the overview. Saying what you want first is the whole difference between
 * reading a repository and getting work done in it.
 */
function toPath(input: string, task: string): string | undefined {
  const spec = parseRepoSpec(input);
  if ('error' in spec) return undefined;
  const query = new URLSearchParams();
  if (spec.ref) query.set('ref', spec.ref);
  if (task.trim()) {
    query.set('tab', 'impact');
    query.set('q', task.trim().slice(0, 300));
  }
  const search = query.toString();
  return `/r/${spec.owner}/${spec.repo}${search ? `?${search}` : ''}`;
}

export function RepoForm({ examples }: { examples: string[] }) {
  const [value, setValue] = useState('');
  const [task, setTask] = useState('');
  const [error, setError] = useState<string>();

  const [opening, setOpening] = useState<string>();
  const go = (input: string) => {
    const path = toPath(input, task);
    if (!path) return setError('Enter a repository as owner/name, or paste its github.com URL.');
    // Said straight away, so it is clear something real is happening.
    setOpening(path.split('?')[0]!.replace(/^\/r\//, ''));
    // A real page load: the workbench needs its own isolation headers for Run.
    window.location.assign(path);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go(value);
      }}
    >
      {/* No autofocus: the form sits far down the landing page, and focusing
          it on load would scroll straight past the hero. */}
      <div className="rounded-[18px] border border-black/30 bg-[#161616] p-2 shadow-[0_30px_60px_-30px_rgb(0_0_0/0.7)] transition-colors focus-within:border-[#d97757]">
        <div className="flex items-center gap-2.5 pl-3">
          <svg viewBox="0 0 16 16" width={18} height={18} className="shrink-0 text-white/50" fill="currentColor" aria-hidden>
            <path d="M8 .2a8 8 0 0 0-2.5 15.6c.4 0 .5-.2.5-.4v-1.5c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.3 1.9.9 2.3.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.6 7.6 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.1 0 3.1-1.9 3.8-3.6 4 .3.3.6.8.6 1.5v2.2c0 .2.1.5.6.4A8 8 0 0 0 8 .2Z" />
          </svg>
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(undefined);
            }}
            placeholder="Paste a GitHub repo"
            aria-label="GitHub repository"
            className="min-w-0 flex-1 bg-transparent py-3 text-[15.5px] text-white outline-none placeholder:text-white/40"
          />
          <button
            type="submit"
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[12px] bg-[#d97757] px-5 text-[15px] font-semibold text-white shadow-[0_8px_24px_-10px_#d97757] transition-transform hover:scale-[1.03]"
          >
            {opening ? (
              <>
                <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Reading
              </>
            ) : (
              <>
                Start
                <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 8h10M9 4l4 4-4 4" />
                </svg>
              </>
            )}
          </button>
        </div>
        <input
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Optional: what should change?"
          aria-label="What do you want to change"
          className="mt-1 block w-full rounded-[10px] bg-white/[0.04] px-3.5 py-2.5 text-[13.5px] text-white outline-none placeholder:text-white/35 focus:bg-white/[0.07]"
        />
      </div>
      {error && <p className="mt-2 text-center text-sm text-bad">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {opening ? (
          <p className="flex items-center gap-2 text-[13px] font-medium text-zinc-800" role="status">
            <span className="size-1.5 animate-pulse rounded-full bg-[#16a34a]" /> Reading {opening} from GitHub, a few seconds…
          </p>
        ) : (
          <>
            {examples.length > 0 && <span className="text-[13px] text-zinc-600">Try a real one:</span>}
            {examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => go(example)}
                className="rounded-full border border-black/10 bg-white/70 px-3 py-1 font-mono text-[12.5px] text-zinc-800 shadow-sm transition-colors hover:border-[#d97757] hover:bg-white"
              >
                {example}
              </button>
            ))}
          </>
        )}
      </div>
    </form>
  );
}
