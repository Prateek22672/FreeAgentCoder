'use client';

import { useState } from 'react';
import { parseRepoSpec } from '@/lib/repoSpec';
import { Button, TextInput } from './ui';

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
    <div>
      <p className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-accent">
        Tell it what you want built
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(value);
        }}
        className="flex gap-2"
      >
        {/* No autofocus: the form sits far down the landing page, and focusing
            it on load would scroll straight past the hero. */}
        <TextInput
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(undefined);
          }}
          placeholder="github.com/owner/repository"
          aria-label="GitHub repository"
          className="h-11 text-[15px]"
        />
        <Button type="submit" className="h-11 px-5">
          Start
        </Button>
      </form>
      <TextInput
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder="What do you want to change? e.g. add Stripe checkout, replace Prisma with Drizzle"
        aria-label="What do you want to change"
        className="mt-2 h-11 text-[15px]"
      />
      <p className="mt-2 text-[13px] leading-relaxed text-faint">
        Say what you want and it reads the repository, shows you what the change would break, and writes the plan — then hands it to the agent in VS Code. Leave it
        empty to just look around.
      </p>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      {examples.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-faint">Try</span>
        {examples.map((example) => (
          <button key={example} type="button" onClick={() => go(example)} className="rounded-md border border-line px-2 py-1 font-mono text-[12.5px] text-muted hover:border-accent hover:text-fg">
            {example}
          </button>
        ))}
      </div>}
    </div>
  );
}
