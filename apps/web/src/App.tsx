import { Activity, Blocks, FlaskConical, KeyRound, LayoutDashboard, Settings as Cog } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Dashboard } from './admin/Dashboard';
import { ModelCheck } from './admin/ModelCheck';
import { Providers } from './admin/Providers';
import { Runs } from './admin/Runs';
import { Settings } from './admin/Settings';
import { Builder } from './builder/Builder';
import { cx } from './components/ui';
import { useAgentSession } from './lib/useAgentSession';

const PAGES: { id: string; label: string; icon: ReactNode; group: 'app' | 'admin' }[] = [
  { id: 'builder', label: 'Builder', icon: <Blocks size={16} />, group: 'app' },
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={16} />, group: 'admin' },
  { id: 'providers', label: 'Providers & keys', icon: <KeyRound size={16} />, group: 'admin' },
  { id: 'check', label: 'Model check', icon: <FlaskConical size={16} />, group: 'admin' },
  { id: 'runs', label: 'Runs', icon: <Activity size={16} />, group: 'admin' },
  { id: 'settings', label: 'Settings', icon: <Cog size={16} />, group: 'admin' },
];

function usePage(): [string, (p: string) => void] {
  const read = () => location.hash.replace(/^#\/?/, '') || 'builder';
  const [page, setPage] = useState(read);
  useEffect(() => {
    const on = () => setPage(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [page, (p) => (location.hash = `/${p}`)];
}

export function App() {
  const [page, go] = usePage();
  const session = useAgentSession();

  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-zinc-800 bg-zinc-950 py-3 md:w-48 md:items-stretch md:px-2">
        <div className="mb-3 flex items-center gap-2 px-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-600 text-sm font-bold">A</div>
          <span className="hidden font-semibold md:inline">Agentic</span>
        </div>
        {PAGES.map((p, i) => (
          <div key={p.id}>
            {p.group === 'admin' && PAGES[i - 1]?.group === 'app' && <div className="mx-2 mb-1 mt-3 hidden text-[10px] uppercase tracking-wider text-zinc-600 md:block">Admin</div>}
            <button
              onClick={() => go(p.id)}
              title={p.label}
              className={cx('flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm', page === p.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200')}
            >
              {p.icon}
              <span className="hidden md:inline">{p.label}</span>
              {p.id === 'builder' && session.running && <span className="ml-auto hidden h-2 w-2 animate-pulse rounded-full bg-violet-400 md:inline" />}
            </button>
          </div>
        ))}
        <div className="mt-auto hidden px-2 text-[10px] leading-4 text-zinc-600 md:block">Runs on free models. Keys never leave your browser except to their provider.</div>
      </nav>
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* The Builder stays mounted so a run keeps going while you look at Admin. */}
        <div className={cx('h-full', page !== 'builder' && 'hidden')}>
          <Builder s={session} />
        </div>
        {page !== 'builder' && (
          <div className="h-full overflow-auto">
            {page === 'dashboard' && <Dashboard go={go} />}
            {page === 'providers' && <Providers />}
            {page === 'check' && <ModelCheck />}
            {page === 'runs' && <Runs />}
            {page === 'settings' && <Settings />}
          </div>
        )}
      </main>
    </div>
  );
}
