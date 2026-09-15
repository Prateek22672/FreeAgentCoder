import { Agent, type AgentOptions } from '../agent/agent';
import { PermissionPolicy, type PermissionMode } from '../agent/permissions';
import { buildLocalSystemPrompt } from '../agent/prompt';
import type { ModelRouter } from '../providers/router';
import { fileTools } from '../tools/index';
import { CodeIndex, searchCodeTool } from '../tools/search';
import type { Message, Todo } from '../types';
import { buildRouter, type AgenticConfig } from './config';
import { environmentTool } from './environment';
import { fetchUrlTool } from './fetch-url';
import { LocalWorkspace } from './local-workspace';
import { isGitRepo, loadProjectInstructions } from './project';
import { detectShell, processTool, ProcessRegistry, runCommandTool, type ShellInfo } from './shell';

export { LocalWorkspace } from './local-workspace';
export { detectShell, killTree, ProcessRegistry, runCommandTool, processTool, type ShellInfo } from './shell';
export { fetchUrlTool, htmlToText } from './fetch-url';
export { environmentTool, inspectEnvironment, TOOLCHAINS, type CommandRunner, type ToolchainCheck } from './environment';
export {
  loadConfig,
  saveConfig,
  configDir,
  configPath,
  buildRouter,
  resolveKey,
  usableProviders,
  presetsWithCustom,
  type AgenticConfig,
  type CustomProvider,
} from './config';
export { loadProjectInstructions, isGitRepo, INSTRUCTION_FILES, INIT_PROMPT } from './project';
export { saveSession, loadSession, listSessions, newSessionId, sessionTitle, type SessionData } from './sessions';

export interface LocalAgentOptions {
  cwd: string;
  config: AgenticConfig;
  /** Overrides config.model ("provider:model"). Ignored when `router` is given. */
  model?: string;
  /** A ready-made model chain (e.g. built from keys an editor stores itself) instead of one built from config. */
  router?: ModelRouter;
  mode?: PermissionMode;
  approve?: AgentOptions['approve'];
  messages?: Message[];
  todos?: Todo[];
  maxSteps?: number;
  /** Name the agent goes by in its system prompt. */
  agentName?: string;
  /** Extra system-prompt guidance from the host app. */
  extraInstructions?: string;
  /** Checked before the agent ends a turn; see AgentOptions.reviewCompletion. */
  reviewCompletion?: AgentOptions['reviewCompletion'];
}

export interface LocalAgent {
  agent: Agent;
  workspace: LocalWorkspace;
  shell: ShellInfo;
  processes: ProcessRegistry;
  /** Local search index over the project, shared with the search_code tool. */
  codeIndex: CodeIndex;
  instructionsFile?: string;
  warnings: string[];
}

/** Everything the CLI needs: workspace, tools, model chain, system prompt. */
export async function createLocalAgent(opts: LocalAgentOptions): Promise<LocalAgent> {
  const workspace = new LocalWorkspace(opts.cwd);
  const shell = detectShell(opts.config.shell);
  const processes = new ProcessRegistry();
  const codeIndex = new CodeIndex(workspace);
  const { router, warnings } = opts.router ? { router: opts.router, warnings: [] } : buildRouter(opts.config, opts.model);
  const instructions = await loadProjectInstructions(workspace.root);

  const systemPrompt = buildLocalSystemPrompt({
    cwd: workspace.root,
    platform: process.platform,
    shell: shell.label,
    isGitRepo: isGitRepo(workspace.root),
    date: new Date().toISOString().slice(0, 10),
    projectInstructions: instructions?.content,
    agentName: opts.agentName,
    extraInstructions: opts.extraInstructions,
  });

  const agent = new Agent({
    router,
    workspace,
    tools: [
      ...fileTools(),
      searchCodeTool(codeIndex),
      runCommandTool(shell, processes),
      processTool(processes),
      fetchUrlTool,
      environmentTool,
    ],
    systemPrompt,
    permissions: new PermissionPolicy(opts.mode ?? opts.config.mode ?? 'ask'),
    approve: opts.approve,
    maxSteps: opts.maxSteps,
    maxContextTokens: opts.config.maxContextTokens,
    messages: opts.messages,
    todos: opts.todos,
    reviewCompletion: opts.reviewCompletion,
  });
  return { agent, workspace, shell, processes, codeIndex, instructionsFile: instructions?.file, warnings };
}
