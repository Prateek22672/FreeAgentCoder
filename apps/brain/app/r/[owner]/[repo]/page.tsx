import type { Metadata } from 'next';
import { Dashboard } from '@/components/Dashboard';

type Params = Promise<{ owner: string; repo: string }>;
type Search = Promise<{ ref?: string; tab?: string; q?: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `${owner}/${repo} · Project Brain`, robots: { index: false, follow: true } };
}

export default async function RepoPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { owner, repo } = await params;
  const { ref, tab, q } = await searchParams;
  const spec = `${decodeURIComponent(owner)}/${decodeURIComponent(repo)}${ref ? `/tree/${ref}` : ''}`;
  return <Dashboard key={spec} repo={spec} initialTab={tab} initialQuery={q?.slice(0, 500)} />;
}
