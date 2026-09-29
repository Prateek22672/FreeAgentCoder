'use client';

import { useRouter } from 'next/navigation';
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
  const router = useRouter();
  const [value, setValue] = useState('');
  const [task, setTask] = useState('');
  const [error, setError] = useState<string>();

  const go = (input: string) => {
    const path = toPath(input, task);
    if (!path) return setError('Enter a repository as owner/name, or paste its github.com URL.');
    router.push(path);
  };

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(value);
        }}
        className="flex gap-2"
      >
        <TextInput
          autoFocus
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
        placeholder="What do you want to change? (optional) — e.g. replace Prisma with Drizzle"
        aria-label="What do you want to change"
        className="mt-2 h-11 text-[15px]"
      />
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
