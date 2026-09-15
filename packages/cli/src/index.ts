import { AllProvidersFailedError, type AgentEvent } from '@agentic/core';
import {
  createLocalAgent,
  loadConfig,
  loadSession,
  newSessionId,
  saveSession,
  sessionTitle,
  usableProviders,
  type AgenticConfig,
  type LocalAgent,
} from '@agentic/core/node';
import { askApproval } from './approve';
import { handleCommand, modelHint } from './commands';
import { TurnRenderer } from './render';
import { runSetup } from './setup';
import { Terminal } from './terminal';
import { c, line } from './ui';

const VERSION = '0.1.0';

interface Args {
  prompt?: string;
  model?: string;
  mode?: 'ask' | 'auto-edit' | 'auto';
  cwd: string;
  resume?: string | true;
  verbose: boolean;
  help: boolean;
  version: boolean;
  command?: 'setup' | 'models';
}

function parseArgs(argv: string[]): Args {
  const args: Args = { cwd: process.cwd(), verbose: false, help: false, version: false };
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i];
    if (a === '-h' || a === '--help') args.help = true;
    else if (a === '-v' || a === '--version') args.version = true;
    else if (a === '-m' || a === '--model') args.model = next();
    else if (a.startsWith('--model=')) args.model = a.slice(8);
    else if (a === '--mode') args.mode = next() as Args['mode'];
    else if (a.startsWith('--mode=')) args.mode = a.slice(7) as Args['mode'];
    else if (a === '--auto') args.mode = 'auto';
    else if (a === '--auto-edit') args.mode = 'auto-edit';
    else if (a === '-C' || a === '--cwd') args.cwd = next() ?? args.cwd;
    else if (a === '-r' || a === '--resume') {
      const v = argv[i + 1];
      args.resume = v && !v.startsWith('-') ? (i++, v) : true;
    } else if (a === '--continue') args.resume = true;
    else if (a === '--verbose') args.verbose = true;
    else if (a === '-p' || a === '--prompt') args.prompt = next();
    else if (a === 'setup' && !words.length) args.command = 'setup';
    else if (a === 'models' && !words.length) args.command = 'models';
    else words.push(a);
  }
  if (words.length && !args.prompt) args.prompt = words.join(' ');
  return args;
}

const USAGE = `${c.bold('agentic')} — an AI coding agent for your terminal, on free models.

${c.bold('Usage')}
  agentic                      interactive session in the current folder
  agentic "fix the failing test"   one task, then exit
  agentic setup                add API keys
  agentic models               list providers and models

${c.bold('Options')}
  -m, --model <ref>     main model, e.g. gemini, groq, groq:openai/gpt-oss-120b, anthropic:claude-opus-5
      --mode <mode>     ask (default) | auto-edit | auto
      --auto            same as --mode auto (careful: commands run without asking)
  -C, --cwd <dir>       project folder
  -r, --resume [id]     resume the last session for this folder (or a specific one)
      --verbose         show the model's reasoning
  -h, --help            this help

Free providers: ${modelHint()}, ollama. Paid (your key): anthropic, openai.
`;

function persistSession(local: LocalAgent, id: string, config: AgenticConfig, cwd: string): Promise<void> {
  const { agent } = local;
  if (!agent.messages.length) return Promise.resolve();
  return saveSession({
    id,
    cwd,
    title: sessionTitle(agent.messages),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    model: agent.router.primaryRef,
    messages: agent.messages,
    todos: agent.todos,
    usage: agent.usage,
  }).catch(() => undefined);
}

async function runTurn(local: LocalAgent, term: Terminal, input: string, verbose: boolean): Promise<AgentEvent | undefined> {
  const controller = new AbortController();
  const renderer = new TurnRenderer({ verbose }, local.agent.router.primaryRef);
  const stopWatching = term.watchInterrupt(() => {
    if (!controller.signal.aborted) {
      controller.abort();
      renderer.spinner.stop();
      line(c.dim('  interrupting…'));
    }
  });
  let last: AgentEvent | undefined;
  try {
    for await (const ev of local.agent.run(input, { signal: controller.signal })) {
      renderer.handle(ev);
      last = ev;
    }
  } finally {
    renderer.spinner.stop();
    stopWatching();
  }
  return last;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    line(USAGE);
    return;
  }
  if (args.version) {
    line(VERSION);
    return;
  }
  const term = new Terminal();
  let config = await loadConfig();

  if (args.command === 'setup') {
    await runSetup(term, config);
    return;
  }
  if (args.command === 'models') {
    await handleCommand('/models', { config } as never);
    return;
  }

  if (!usableProviders(config).length) {
    if (!term.interactive) {
      line(c.red('No model configured. Set GEMINI_API_KEY, GROQ_API_KEY, CEREBRAS_API_KEY, … or run: agentic setup'));
      process.exitCode = 1;
      return;
    }
    line(c.yellow('No API keys found yet. Let’s add a free one.'));
    line();
    config = await runSetup(term, config);
    if (!usableProviders(config).length) return;
    line();
  }

  let resumed: Awaited<ReturnType<typeof loadSession>> = null;
  if (args.resume) {
    resumed = await loadSession(args.cwd, args.resume === true ? undefined : args.resume);
    if (!resumed) line(c.yellow('No saved session found for this folder; starting fresh.'));
  }

  const local = await createLocalAgent({
    cwd: args.cwd,
    config,
    model: args.model,
    mode: args.mode,
    approve: (req) => askApproval(term, req),
    messages: resumed?.messages,
    todos: resumed?.todos,
  });
  const sessionId = resumed?.id ?? newSessionId();
  const { agent } = local;
  for (const w of local.warnings) line(c.yellow(`! ${w}`));
  if (!agent.router.chain.length) {
    line(c.red('No usable model. Run: agentic setup'));
    process.exitCode = 1;
    return;
  }
  agent.setApprover((req) => askApproval(term, req));

  const cleanup = () => {
    local.processes.killAll();
    term.close();
  };
  process.on('exit', cleanup);

  let verbose = args.verbose;

  // One-shot mode.
  if (args.prompt) {
    const last = await runTurn(local, term, args.prompt, verbose);
    await persistSession(local, sessionId, config, local.workspace.root);
    if (last?.type === 'done' && last.reason === 'error') process.exitCode = 1;
    cleanup();
    return;
  }

  line(`${c.bold(c.magenta('agentic'))} ${c.dim(`v${VERSION}`)}  ${c.dim(local.workspace.root)}`);
  line(c.dim(`model ${agent.router.primaryRef} · mode ${agent.permissions.mode} · ${local.instructionsFile ? `using ${local.instructionsFile}` : 'no AGENTS.md (try /init)'} · /help for commands`));
  if (resumed) line(c.dim(`resumed session ${resumed.id}: "${resumed.title}"`));
  line();

  const ctx = {
    local,
    config,
    term,
    sessionId,
    get verbose() {
      return verbose;
    },
    setVerbose(v: boolean) {
      verbose = v;
    },
    runPrompt: async (prompt: string) => {
      await runTurn(local, term, prompt, verbose);
    },
  };

  for (;;) {
    const input = await term.prompt(c.bold(c.magenta('› ')));
    if (input === null) break;
    const text = input.trim();
    if (!text) continue;
    const handled = await handleCommand(text, ctx);
    if (handled === 'exit') break;
    if (handled === 'handled') {
      line();
      continue;
    }
    try {
      await runTurn(local, term, text, verbose);
    } catch (err) {
      line(c.red(err instanceof AllProvidersFailedError ? err.message : `Error: ${(err as Error).message}`));
    }
    line();
    await persistSession(local, sessionId, config, local.workspace.root);
  }
  await persistSession(local, sessionId, config, local.workspace.root);
  line(c.dim('bye'));
  cleanup();
}

main().catch((err) => {
  line(c.red(`Fatal: ${(err as Error).stack ?? err}`));
  process.exit(1);
});
