import type { AgentEvent, ApprovalDecision, ApprovalRequest, Message, Todo, ToolDisplay, CallRecord } from '@agentic/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db, notifyRunsChanged, type ProjectRecord, type RunRecord, type ToolStep } from './db';
import { PreviewBridge } from './preview';
import { createBuilderSession, type BuilderSession } from './session';
import { getSettings } from './settings';
import { PROJECT_NAME_DEFAULT, TEMPLATE_FILES } from './template';

export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; reasoning: string; streaming: boolean; model?: string }
  | { kind: 'tool'; id: string; name: string; label: string; status: 'running' | 'ok' | 'error' | 'denied'; summary?: string; display?: ToolDisplay; content?: string }
  | { kind: 'notice'; id: string; text: string; level: 'info' | 'warn' | 'error' }
  | { kind: 'status'; id: string; text: string };

export interface PendingApproval {
  request: ApprovalRequest;
  resolve: (d: ApprovalDecision) => void;
}

let counter = 0;
const uid = () => `i${++counter}`;

/** Rebuild the chat transcript from saved messages (when loading a project). */
function itemsFromMessages(messages: Message[]): ChatItem[] {
  const items: ChatItem[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      if (!m.synthetic) items.push({ kind: 'user', id: uid(), text: m.content });
    } else if (m.role === 'assistant') {
      if (m.content) items.push({ kind: 'assistant', id: uid(), text: m.content, reasoning: '', streaming: false, model: m.model });
      for (const call of m.toolCalls ?? []) {
        items.push({ kind: 'tool', id: call.id, name: call.name, label: labelFor(call.name, call.args), status: 'ok' });
      }
    } else {
      const tool = items.find((i) => i.kind === 'tool' && i.id === m.toolCallId) as Extract<ChatItem, { kind: 'tool' }> | undefined;
      if (tool) {
        tool.status = m.isError ? 'error' : 'ok';
        tool.content = m.content;
      }
    }
  }
  return items;
}

function labelFor(name: string, args: Record<string, unknown>): string {
  const path = typeof args.path === 'string' ? args.path : '';
  switch (name) {
    case 'read_file':
      return `Read ${path}`;
    case 'edit_file':
      return `Edit ${path}`;
    case 'write_file':
      return `Write ${path}`;
    case 'grep':
      return `Search /${String(args.pattern ?? '')}/`;
    case 'glob':
      return `Find ${String(args.pattern ?? '')}`;
    case 'list_dir':
      return `List ${path || '.'}`;
    case 'todo_write':
      return 'Update plan';
    case 'check_preview':
      return 'Check preview';
    default:
      return name;
  }
}

export interface AgentSession {
  project: ProjectRecord;
  items: ChatItem[];
  todos: Todo[];
  running: boolean;
  approval: PendingApproval | null;
  bridge: PreviewBridge;
  session: BuilderSession;
  /** Bumps when files change, so the file tree/preview re-render. */
  filesVersion: number;
  run(prompt: string): Promise<void>;
  stop(): void;
  undo(): Promise<void>;
  newProject(): void;
  loadProject(id: string): Promise<void>;
  rename(name: string): void;
  /** Recreate the agent after settings (keys, model) changed. */
  reconfigure(): void;
}

function blankProject(): ProjectRecord {
  const now = Date.now();
  return { id: `p${now.toString(36)}`, name: PROJECT_NAME_DEFAULT, createdAt: now, updatedAt: now, files: { ...TEMPLATE_FILES }, messages: [], todos: [] };
}

export function useAgentSession(): AgentSession {
  const bridge = useMemo(() => new PreviewBridge(), []);
  const [project, setProject] = useState<ProjectRecord>(blankProject);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [running, setRunning] = useState(false);
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [filesVersion, setFilesVersion] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const callsRef = useRef<CallRecord[]>([]);
  const approvalRef = useRef<(r: ApprovalRequest) => Promise<ApprovalDecision>>(async () => ({ allow: false }));

  const approve = useCallback(
    (request: ApprovalRequest) =>
      new Promise<ApprovalDecision>((resolve) => {
        setApproval({
          request,
          resolve: (d) => {
            setApproval(null);
            resolve(d);
          },
        });
      }),
    [],
  );
  approvalRef.current = approve;

  const makeSession = useCallback(
    (p: ProjectRecord) => {
      const created = createBuilderSession({
        files: p.files,
        bridge,
        messages: p.messages,
        todos: p.todos,
        approve: (r) => approvalRef.current(r),
        onCall: (r) => callsRef.current.push(r),
      });
      // The starter files are described in the system prompt: let the model replace them without reading first.
      if (!p.messages.length) {
        const untouched = Object.keys(TEMPLATE_FILES).filter((path) => p.files[path] === TEMPLATE_FILES[path]);
        void created.agent.trustFiles(untouched);
      }
      return created;
    },
    [bridge],
  );

  const [session, setSession] = useState<BuilderSession>(() => makeSession(project));

  // Keep the project record in sync with the workspace, and tell the preview.
  useEffect(() => {
    return session.workspace.subscribe(() => {
      bridge.fileChanged();
      setFilesVersion((v) => v + 1);
    });
  }, [session, bridge]);

  const persist = useCallback(
    async (p: ProjectRecord, s: BuilderSession) => {
      const record: ProjectRecord = {
        ...p,
        files: s.workspace.snapshot(),
        messages: s.agent.messages,
        todos: s.agent.todos,
        updatedAt: Date.now(),
      };
      setProject(record);
      await db.putProject(record).catch(() => undefined);
    },
    [],
  );

  const run = useCallback(
    async (prompt: string) => {
      if (running) return;
      const { agent } = session;
      const controller = new AbortController();
      abortRef.current = controller;
      callsRef.current = [];
      setRunning(true);
      const started = Date.now();
      const runRecord: RunRecord = {
        id: `r${started.toString(36)}`,
        projectId: project.id,
        projectName: project.name,
        prompt,
        startedAt: started,
        ms: 0,
        reason: 'running',
        steps: 0,
        models: [],
        inputTokens: 0,
        outputTokens: 0,
        tools: [],
        calls: [],
        notices: [],
        reply: '',
        compactions: 0,
      };
      const toolStarts = new Map<string, number>();
      let assistantId: string | null = null;

      setItems((prev) => [...prev, { kind: 'user', id: uid(), text: prompt }]);
      const patch = (id: string, fn: (item: ChatItem) => ChatItem) =>
        setItems((prev) => prev.map((it) => (it.id === id ? fn(it) : it)));

      try {
        for await (const ev of agent.run(prompt, { signal: controller.signal })) {
          switch (ev.type) {
            case 'model':
              runRecord.steps = ev.step;
              if (!runRecord.models.includes(ev.ref)) runRecord.models.push(ev.ref);
              assistantId = null;
              break;
            case 'text':
            case 'reasoning': {
              if (!assistantId) {
                assistantId = uid();
                const id = assistantId;
                setItems((prev) => [...prev, { kind: 'assistant', id, text: '', reasoning: '', streaming: true }]);
              }
              const field = ev.type === 'text' ? 'text' : 'reasoning';
              patch(assistantId, (it) => (it.kind === 'assistant' ? { ...it, [field]: it[field] + ev.delta } : it));
              break;
            }
            case 'reset':
              if (assistantId) {
                const id = assistantId;
                setItems((prev) => prev.filter((it) => it.id !== id));
                assistantId = null;
              }
              break;
            case 'assistant':
              if (assistantId) {
                const id = assistantId;
                patch(id, (it) => (it.kind === 'assistant' ? { ...it, text: ev.message.content, streaming: false, model: ev.message.model } : it));
                if (!ev.message.content && !ev.message.reasoning) setItems((prev) => prev.filter((it) => it.id !== id));
              } else if (ev.message.content) {
                setItems((prev) => [...prev, { kind: 'assistant', id: uid(), text: ev.message.content, reasoning: '', streaming: false, model: ev.message.model }]);
              }
              runRecord.reply = ev.message.content || runRecord.reply;
              assistantId = null;
              break;
            case 'tool_start':
              toolStarts.set(ev.call.id, Date.now());
              setItems((prev) => [...prev, { kind: 'tool', id: ev.call.id, name: ev.call.name, label: ev.label, status: 'running' }]);
              break;
            case 'tool_end': {
              const step: ToolStep = {
                name: ev.call.name,
                label: ev.label,
                ok: !ev.result.isError,
                ms: Date.now() - (toolStarts.get(ev.call.id) ?? Date.now()),
                summary: ev.result.summary,
                error: ev.result.isError ? ev.result.content.slice(0, 300) : undefined,
                denied: ev.denied,
              };
              runRecord.tools.push(step);
              patch(ev.call.id, (it) =>
                it.kind === 'tool'
                  ? { ...it, status: ev.denied ? 'denied' : ev.result.isError ? 'error' : 'ok', summary: ev.result.summary, display: ev.result.display, content: ev.result.content }
                  : it,
              );
              break;
            }
            case 'todos':
              setTodos(ev.todos);
              break;
            case 'notice':
              runRecord.notices.push(ev.message);
              setItems((prev) => [...prev, { kind: 'notice', id: uid(), text: ev.message, level: 'warn' }]);
              break;
            case 'compacted':
              runRecord.compactions++;
              setItems((prev) => [...prev, { kind: 'status', id: uid(), text: `Context ${ev.kind === 'micro' ? 'trimmed' : 'summarized'}: ${ev.before} → ${ev.after} tokens` }]);
              break;
            case 'usage':
              runRecord.inputTokens += ev.usage.inputTokens;
              runRecord.outputTokens += ev.usage.outputTokens;
              break;
            case 'error':
              runRecord.error = ev.message;
              setItems((prev) => [...prev, { kind: 'notice', id: uid(), text: ev.message, level: 'error' }]);
              break;
            case 'done':
              runRecord.reason = ev.reason;
              runRecord.steps = ev.steps;
              if (ev.reason === 'max_steps') setItems((prev) => [...prev, { kind: 'status', id: uid(), text: 'Paused at the step limit. Send "continue" to keep going.' }]);
              if (ev.reason === 'aborted') setItems((prev) => [...prev, { kind: 'status', id: uid(), text: 'Stopped.' }]);
              break;
          }
        }
      } catch (err) {
        runRecord.reason = 'error';
        runRecord.error = (err as Error).message;
        setItems((prev) => [...prev, { kind: 'notice', id: uid(), text: (err as Error).message, level: 'error' }]);
      } finally {
        runRecord.ms = Date.now() - started;
        runRecord.calls = callsRef.current.map((c) => ({
          ref: c.ref,
          ok: c.ok,
          errorKind: c.errorKind,
          error: c.error,
          ms: c.ms,
          inputTokens: c.usage?.inputTokens,
          outputTokens: c.usage?.outputTokens,
          at: c.at,
        }));
        if (runRecord.reason === 'running') runRecord.reason = 'completed';
        setRunning(false);
        setApproval(null);
        abortRef.current = null;
        setTodos([...agent.todos]);
        await db.putRun(runRecord).catch(() => undefined);
        notifyRunsChanged();
        await persist(project, session);
      }
    },
    [running, session, project, persist],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    approval?.resolve({ allow: false, feedback: 'Stopped by the user.' });
  }, [approval]);

  const undo = useCallback(async () => {
    const result = await session.agent.undo();
    if (result) {
      setItems((prev) => [...prev, { kind: 'status', id: uid(), text: `Reverted ${[...result.restored, ...result.deleted].length} file(s).` }]);
      await persist(project, session);
    }
  }, [session, project, persist]);

  const newProject = useCallback(() => {
    if (running) return;
    const p = blankProject();
    setProject(p);
    setItems([]);
    setTodos([]);
    setSession(makeSession(p));
  }, [running, makeSession]);

  const loadProject = useCallback(
    async (id: string) => {
      if (running) return;
      const p = await db.getProject(id);
      if (!p) return;
      setProject(p);
      setItems(itemsFromMessages(p.messages));
      setTodos(p.todos);
      setSession(makeSession(p));
    },
    [running, makeSession],
  );

  const rename = useCallback(
    (name: string) => {
      const p = { ...project, name };
      setProject(p);
      void db.putProject({ ...p, files: session.workspace.snapshot(), messages: session.agent.messages, todos: session.agent.todos });
    },
    [project, session],
  );

  const reconfigure = useCallback(() => {
    if (running) return;
    const snapshot: ProjectRecord = { ...project, files: session.workspace.snapshot(), messages: session.agent.messages, todos: session.agent.todos };
    setProject(snapshot);
    setSession(makeSession(snapshot));
  }, [running, project, session, makeSession]);

  // Settings changed elsewhere (Admin tab): rebuild the router on the next turn.
  useEffect(() => {
    let last = JSON.stringify(getSettings());
    const timer = setInterval(() => {
      const now = JSON.stringify(getSettings());
      if (now !== last) {
        last = now;
        reconfigure();
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [reconfigure]);

  return { project, items, todos, running, approval, bridge, session, filesVersion, run, stop, undo, newProject, loadProject, rename, reconfigure };
}
