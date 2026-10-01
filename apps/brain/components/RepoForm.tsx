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

  const go = (input: string) => {
    const path = toPath(input, task);
    if (!path) return setError('Enter a repository as owner/name, or paste its github.com URL.');
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
      <div className="rounded-[14px] border border-white/12 bg-[#1f1f1f] transition-colors focus-within:border-[#d97757]">
        <div className="flex items-center gap-2 border-b border-white/[0.07] px-3.5 py-2.5">
          <svg viewBox="0 0 16 16" width={15} height={15} className="shrink-0 text-white/45" fill="currentColor" aria-hidden>
            <path d="M8 .2a8 8 0 0 0-2.5 15.6c.4 0 .5-.2.5-.4v-1.5c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.3 1.9.9 2.3.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.6 7.6 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.1 0 3.1-1.9 3.8-3.6 4 .3.3.6.8.6 1.5v2.2c0 .2.1.5.6.4A8 8 0 0 0 8 .2Z" />
          </svg>
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(undefined);
            }}
            placeholder="github.com/owner/repository"
            aria-label="GitHub repository"
            className="min-w-0 flex-1 bg-transparent font-mono text-[14px] text-white outline-none placeholder:text-white/35"
          />
        </div>
        <input
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="What should change? e.g. add Stripe checkout, replace Prisma with Drizzle"
          aria-label="What do you want to change"
          className="block w-full bg-transparent px-3.5 pb-1 pt-3 text-[14px] text-white outline-none placeholder:text-white/35"
        />
        <div className="flex flex-wrap items-center gap-2 px-2.5 pb-2.5 pt-2">
          {examples.length > 0 && <span className="pl-1 text-[12px] text-white/40">Try</span>}
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => go(example)}
              className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[11.5px] text-white/65 transition-colors hover:border-[#d97757] hover:text-white"
            >
              {example}
            </button>
          ))}
          <button
            type="submit"
            className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#d97757] px-4 text-[14px] font-semibold text-white shadow-[0_8px_24px_-10px_#d97757] transition-transform hover:scale-[1.03]"
          >
            Start
            <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      <p className="mt-2.5 px-1 text-[12px] leading-relaxed text-white/40">
        Leave the change empty to just look around. Read-only: the code is never run or stored.
      </p>
    </form>
  );
}
