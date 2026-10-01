import { InstallLink } from '@/components/InstallLink';
import { Arrow } from './Hero';

/** Real requests and what Fyx runs for them. The commands are the ones it really produces. */
const CHORES: { ask: string; run: string; result: string }[] = [
    { ask: 'run the website locally', run: 'npm --prefix homes run dev', result: 'Running at http://localhost:5173' },
    { ask: 'zip the homes folder', run: 'tar -a -c -f homes.zip homes', result: 'homes.zip · node_modules and .git left out' },
    { ask: 'commit everything with message "fix navbar" and push', run: 'git add -A && git commit && git push', result: 'Committed and pushed' },
    { ask: 'install the dependencies', run: 'npm install', result: 'Installed with your package manager' },
    { ask: 'create a new branch called feature/login', run: 'git switch -c feature/login', result: 'On feature/login' },
    { ask: 'clone https://github.com/expressjs/express', run: 'git clone …/expressjs/express', result: 'Cloned' },
    { ask: 'add axios and zod', run: 'npm install axios zod', result: 'Added' },
    { ask: 'what are the biggest folders?', run: 'measures every folder', result: 'node_modules 129 MB · dist 38 MB…' },
];

/**
 * Fyx: the chores people hate, done on their machine without an AI model.
 * The comparison is one measured run, said as such.
 */
export function Chores() {
    return (
        <section className="force-dark bg-[#070708] px-5 py-28 text-white sm:px-10" aria-labelledby="fyx-title">
            <div className="mx-auto max-w-6xl">
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/50">Fyx · built in</p>
                <h2 id="fyx-title" className="cine-display mt-5 max-w-4xl text-[clamp(2.4rem,6vw,4.6rem)] font-medium leading-[0.98] tracking-[-0.04em]">
                    The chores, done for you. <span className="text-white/40">Zero tokens.</span>
                </h2>
                <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-white/65">
                    Getting a project running on localhost, zipping a folder, pushing to git: nobody enjoys them, and an AI model is slow and wasteful at them. <b className="text-white">Fyx</b>, FreeAgentCoder&rsquo;s own task engine, does them on your machine without a model. Ask in plain words, approve the command, and carry on: it hands you the localhost link and your free keys stay for real work.
                </p>

                <div className="mt-12 grid gap-4 md:grid-cols-[1.1fr_1fr]">
                    <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-6">
                        <p className="text-[13px] text-white/50">One real request, measured</p>
                        <p className="mt-2 text-[17px] font-medium">&ldquo;make the whole homes folder into a zip named home-zip&rdquo;</p>
                        <div className="mt-6 grid grid-cols-2 gap-3">
                            <div className="rounded-[14px] border border-white/10 bg-black/40 p-4">
                                <p className="text-[12px] uppercase tracking-[0.14em] text-white/45">An AI model</p>
                                <p className="cine-display mt-3 text-[2rem] font-medium leading-none">4 min 36 s</p>
                                <p className="mt-2 text-[13.5px] text-white/60">17,000 tokens · 9 steps · switched model 3 times · zipped 129 MB of node_modules</p>
                            </div>
                            <div className="rounded-[14px] border border-[#4ade80]/30 bg-[#4ade80]/[0.06] p-4">
                                <p className="text-[12px] uppercase tracking-[0.14em] text-[#4ade80]">Fyx</p>
                                <p className="cine-display mt-3 text-[2rem] font-medium leading-none">0.2 s</p>
                                <p className="mt-2 text-[13.5px] text-white/70">0 tokens · 1 command · node_modules and .git left out</p>
                            </div>
                        </div>
                        <p className="mt-5 text-[13px] leading-relaxed text-white/50">
                            It learns as you go: when the agent finishes a short request with a single command, Fyx does that request itself the next time. Anything it is not sure about goes to the AI agent, as before.
                        </p>
                    </div>

                    <ul className="grid gap-2.5">
                        {CHORES.map((chore) => (
                            <li key={chore.ask} className="rounded-[14px] border border-white/10 bg-white/[0.03] px-4 py-3">
                                <p className="text-[14px] text-white">&ldquo;{chore.ask}&rdquo;</p>
                                <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                                    <code className="font-mono text-white/55">$ {chore.run}</code>
                                    <span className="text-[#4ade80]">✓ {chore.result}</span>
                                    <span className="ml-auto font-mono text-white/35">0 tokens</span>
                                </p>
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="mt-10 flex flex-wrap items-center gap-3">
                    <InstallLink className="inline-flex items-center gap-2 rounded-[12px] bg-white px-5 py-3 text-[14.5px] font-medium text-zinc-950 transition-transform hover:scale-[1.03]">
                        Get Fyx in VS Code, free <Arrow size={14} />
                    </InstallLink>
                    <span className="text-[13px] text-white/45">Every command still asks your permission first.</span>
                </div>
            </div>
        </section>
    );
}
