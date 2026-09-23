'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { parseRepoSpec } from '@/lib/repoSpec';
import { Button, TextInput } from './ui';

function toPath(input: string): string | undefined {
  const spec = parseRepoSpec(input);
  if ('error' in spec) return undefined;
  return `/r/${spec.owner}/${spec.repo}${spec.ref ? `?ref=${encodeURIComponent(spec.ref)}` : ''}`;
}

export function RepoForm({ examples }: { examples: string[] }) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();

  const go = (input: string) => {
    const path = toPath(input);
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
          Analyze
        </Button>
      </form>
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
