import { createProvider, PERMISSION_MODES, PRESETS, parseModelRef, refOf, type PermissionMode } from '@agentic/core';
import {
  listSessions,
  presetsWithCustom,
  resolveKey,
  saveConfig,
  usableProviders,
  type AgenticConfig,
  type LocalAgent,
} from '@agentic/core/node';
import { renderTodos } from './render';
import type { Terminal } from './terminal';
import { c, formatTokens, line } from './ui';

export interface CommandContext {
  local: LocalAgent;
  config: AgenticConfig;
  term: Terminal;
  sessionId: string;
  verbose: boolean;
  setVerbose(v: boolean): void;
  /** Ask the outer loop to run a prompt as if the user typed it. */
  runPrompt(prompt: string): Promise<void>;
}

const HELP = `
${c.bold('Commands')}
  /help              show this help
  /model [ref]       show or switch the main model (e.g. /model gemini, /model groq:openai/gpt-oss-120b)
  /models            list configured providers and their models
  /mode [mode]       permission mode: ask | auto-edit | auto
  /todos             show the agent's current plan
  /undo              revert the file changes from the last turn
  /compact           summarize the conversation to free up context
  /clear             start a fresh conversation (files are untouched)
  /context           how full the context window is
  /cost              token usage this session
  /sessions          list saved sessions for this folder
  /init              write an AGENTS.md for this project
  /verbose           toggle showing the model's reasoning
  /exit              quit

${c.bold('Tips')}
  End a line with \\ to continue on the next line. Ctrl+C or Esc interrupts the agent.
  Answer an approval with feedback ("use pnpm instead") and the agent adapts.
`;

export async function handleCommand(input: string, ctx: CommandContext): Promise<'handled' | 'exit' | 'not-command'> {
  if (!input.startsWith('/')) return 'not-command';
  const [cmd, ...rest] = input.slice(1).trim().split(/\s+/);
  const arg = rest.join(' ').trim();
  const { agent } = ctx.local;

  switch ((cmd ?? '').toLowerCase()) {
    case 'help':
    case '?':
      line(HELP);
      return 'handled';
    case 'exit':
    case 'quit':
    case 'q':
      return 'exit';
    case 'model':
      return switchModel(arg, ctx);
    case 'models':
      listModels(ctx.config);
      return 'handled';
    case 'mode':
      return switchMode(arg, ctx);
    case 'todos':
    case 'plan':
      line(agent.todos.length ? renderTodos(agent.todos).join('\n') : c.dim('No plan yet.'));
      return 'handled';
    case 'undo': {
      const result = await agent.undo();
      if (!result) line(c.dim('Nothing to undo.'));
      else line(c.green(`Reverted: ${[...result.restored, ...result.deleted].map((p) => ctx.local.workspace.relative(p)).join(', ')}`));
      return 'handled';
    }
    case 'compact':
      for await (const ev of agent.compact()) {
        if (ev.type === 'compacted') line(c.dim(`Context: ${formatTokens(ev.before)} → ${formatTokens(ev.after)} tokens`));
        else if (ev.type === 'notice') line(c.dim(ev.message));
      }
      return 'handled';
    case 'clear':
    case 'new':
      agent.clear();
      line(c.dim('Started a new conversation.'));
      return 'handled';
    case 'context': {
      const used = agent.contextTokens();
      const limit = agent.contextLimit();
      line(`Context: ${formatTokens(used)} of ~${formatTokens(limit)} tokens (${Math.round((used / limit) * 100)}%) · ${agent.messages.length} messages`);
      return 'handled';
    }
    case 'cost':
      line(`Session tokens: ${formatTokens(agent.usage.inputTokens)} in, ${formatTokens(agent.usage.outputTokens)} out · ${c.green('$0.00')} on free tiers`);
      return 'handled';
    case 'sessions': {
      const sessions = await listSessions(ctx.local.workspace.root);
      if (!sessions.length) line(c.dim('No saved sessions for this folder.'));
      for (const s of sessions.slice(0, 15)) {
        line(`${s.id === ctx.sessionId ? c.green('●') : ' '} ${c.bold(s.id)}  ${c.dim(s.updatedAt.slice(0, 16).replace('T', ' '))}  ${s.title}`);
      }
      line(c.dim('Resume one with: agentic --resume <id>'));
      return 'handled';
    }
    case 'init': {
      const { INIT_PROMPT } = await import('@agentic/core/node');
      await ctx.runPrompt(INIT_PROMPT);
      return 'handled';
    }
    case 'verbose':
      ctx.setVerbose(!ctx.verbose);
      line(c.dim(`Reasoning display ${ctx.verbose ? 'on' : 'off'}.`));
      return 'handled';
    default:
      line(c.yellow(`Unknown command /${cmd}. Type /help.`));
      return 'handled';
  }
}

function listModels(config: AgenticConfig): void {
  const usable = new Set(usableProviders(config).map((p) => p.id));
  for (const preset of Object.values(presetsWithCustom(config))) {
    const status = usable.has(preset.id) ? c.green('ready') : c.dim(preset.needsKey ? `needs ${preset.keyEnv[0] ?? 'a key'}` : 'not enabled');
    line(`${c.bold(preset.label.padEnd(26))} ${status}  ${preset.free ? c.green('free') : c.yellow('paid')}`);
    line(c.dim(`  ${preset.models.map((m) => `${preset.id}:${m}`).join('  ')}`));
  }
}

async function switchModel(arg: string, ctx: CommandContext): Promise<'handled'> {
  const { router } = ctx.local.agent;
  if (!arg) {
    line(`Main model: ${c.bold(router.primaryRef)}`);
    const rest = router.chain.slice(1).map(refOf);
    if (rest.length) line(c.dim(`Fallbacks: ${rest.join(' → ')}`));
    line(c.dim('Switch with /model <provider[:model]>. See /models.'));
    return 'handled';
  }
  const presets = presetsWithCustom(ctx.config);
  let ref;
  try {
    ref = parseModelRef(arg, presets);
  } catch (err) {
    line(c.red((err as Error).message));
    return 'handled';
  }
  const preset = presets[ref.provider]!;
  const usable = usableProviders(ctx.config).some((p) => p.id === ref.provider);
  if (!usable) {
    line(c.red(`${preset.label} isn't configured.${preset.keyEnv[0] ? ` Set ${preset.keyEnv[0]} or run: agentic setup` : ''}`));
    return 'handled';
  }
  const existing = router.chain.find((e) => e.provider.id === ref.provider && e.model === ref.model);
  router.prefer(
    existing ?? {
      provider: createProvider(preset, { apiKey: resolveKey(preset, ctx.config), baseURL: ctx.config.baseURLs?.[preset.id], effort: ctx.config.effort }),
      model: ref.model,
      contextWindow: preset.contextWindow,
      maxRequestTokens: preset.maxRequestTokens,
      prefer: preset.prefer,
    },
  );
  ctx.config.model = `${ref.provider}:${ref.model}`;
  await saveConfig(ctx.config);
  line(`Main model: ${c.bold(router.primaryRef)}${preset.free ? '' : c.yellow('  (paid provider)')}`);
  return 'handled';
}

async function switchMode(arg: string, ctx: CommandContext): Promise<'handled'> {
  const { permissions } = ctx.local.agent;
  if (!arg) {
    line(`Permission mode: ${c.bold(permissions.mode)}  ${c.dim('(ask | auto-edit | auto)')}`);
    return 'handled';
  }
  const mode = arg.toLowerCase().replace('autoedit', 'auto-edit') as PermissionMode;
  if (!PERMISSION_MODES.includes(mode)) {
    line(c.red(`Unknown mode "${arg}". Use ask, auto-edit or auto.`));
    return 'handled';
  }
  permissions.mode = mode;
  ctx.config.mode = mode;
  await saveConfig(ctx.config);
  line(`Permission mode: ${c.bold(mode)}${mode === 'auto' ? c.yellow('  — commands run without asking (dangerous ones still ask)') : ''}`);
  return 'handled';
}

export function modelHint(): string {
  return Object.values(PRESETS)
    .filter((p) => p.free && p.id !== 'ollama')
    .map((p) => p.id)
    .join(', ');
}
