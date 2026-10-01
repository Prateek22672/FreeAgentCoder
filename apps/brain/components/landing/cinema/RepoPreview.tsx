import { Logo } from '@/components/Logo';

/**
 * What Project Brain gives back, drawn as its window: the stack, the layers,
 * an answer that cites lines, and what a change would touch. An example from
 * expressjs/express, so people see the result before they try their own.
 */
export function RepoPreview() {
    return (
        <div className="overflow-hidden rounded-[18px] border border-black/40 bg-[#141414] text-[#cccccc] shadow-[0_50px_100px_-40px_rgb(0_0_0/0.75)]" aria-label="Example result for expressjs/express">
            <div className="flex items-center gap-3 border-b border-white/[0.06] bg-[#1a1a1a] px-4 py-2.5">
                <span className="flex gap-1.5" aria-hidden>
                    <span className="size-2.5 rounded-full bg-white/15" />
                    <span className="size-2.5 rounded-full bg-white/15" />
                    <span className="size-2.5 rounded-full bg-white/15" />
                </span>
                <span className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[13px] font-medium text-white">
                    <Logo size={13} className="text-[#d97757]" /> Project Brain
                </span>
                <span className="truncate font-mono text-[12px] text-white/45">/ expressjs/express</span>
                <span className="ml-auto hidden rounded-full border border-[#4ade80]/30 bg-[#4ade80]/10 px-2 py-0.5 text-[11px] text-[#4ade80] sm:inline">Example result</span>
            </div>

            <div className="flex gap-1 border-b border-white/[0.06] px-3 text-[12.5px]">
                {['Overview', 'Ask', 'Impact', 'Plan'].map((tab, i) => (
                    <span key={tab} className={`px-3 py-2 ${i === 2 ? 'border-b-2 border-[#d97757] text-white' : 'text-white/45'}`}>
                        {tab}
                    </span>
                ))}
            </div>

            <div className="grid gap-px bg-white/[0.06] md:grid-cols-3">
                <div className="bg-[#141414] p-4">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-white/40">Stack</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {['Node.js', 'Express', 'Mocha', 'supertest'].map((s) => (
                            <span key={s} className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[12px] text-white/80">
                                {s}
                            </span>
                        ))}
                    </div>
                    <p className="mt-4 text-[11px] uppercase tracking-[0.14em] text-white/40">Layers</p>
                    <ul className="mt-2 space-y-1.5 text-[12.5px]">
                        {[
                            ['Core', 'lib/express.js, lib/application.js'],
                            ['Request and response', 'lib/request.js, lib/response.js'],
                            ['Tests', 'test/'],
                        ].map(([name, files]) => (
                            <li key={name}>
                                <span className="text-white/85">{name}</span>
                                <span className="block truncate font-mono text-[11px] text-white/40">{files}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="bg-[#141414] p-4">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-white/40">Ask</p>
                    <p className="mt-2 rounded-[10px] border border-white/10 bg-[#1f1f1f] px-3 py-2 text-[12.5px] text-white">Where are cookies set on a response?</p>
                    <p className="mt-2.5 text-[12.5px] leading-relaxed text-white/70">
                        In <span className="font-mono text-[11.5px] text-[#ffb59a]">res.cookie()</span>, which builds the header and appends it to the response.
                    </p>
                    <span className="mt-2 inline-block rounded-md bg-white/[0.06] px-2 py-0.5 font-mono text-[11px] text-white/55">lib/response.js</span>
                </div>

                <div className="bg-[#141414] p-4">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-white/40">Change: add rate limiting</p>
                    <ul className="mt-2 space-y-1 font-mono text-[11.5px] text-white/75">
                        {['lib/application.js', 'lib/express.js', 'test/app.js', 'package.json'].map((f) => (
                            <li key={f} className="flex items-center gap-2">
                                <span className="size-1.5 rounded-full bg-[#d97757]" /> {f}
                            </li>
                        ))}
                    </ul>
                    <p className="mt-3 text-[12px] text-white/55">
                        Risk <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-amber-300">medium</span> · plan in 5 steps
                    </p>
                    <span className="mt-3 inline-flex items-center gap-1.5 rounded-[8px] bg-white px-3 py-1.5 text-[12px] font-semibold text-zinc-950">Work on this in VS Code →</span>
                </div>
            </div>
        </div>
    );
}
