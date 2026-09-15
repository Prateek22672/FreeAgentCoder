import { lineDiff, type Todo, type ToolDisplay } from '@agentic/core';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Circle, Loader2, Send, Square, Undo2, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, cx } from '../components/ui';
import { Markdown } from '../lib/markdown';
import type { ChatItem, PendingApproval } from '../lib/useAgentSession';
import { EXAMPLE_PROMPTS } from '../lib/template';

function DiffView({ d }: { d: Extract<ToolDisplay, { type: 'diff' }> }) {
  const rows = lineDiff(d.before, d.after, 2).slice(0, 80);
  return (
    <pre className="mt-1 max-h-72 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-2 font-mono text-[11.5px] leading-4">
      {rows.map((r, i) => (
        <div key={i} className={cx(r.kind === 'add' && 'bg-emerald-500/10 text-emerald-300', r.kind === 'del' && 'bg-red-500/10 text-red-300', r.kind === 'ctx' && 'text-zinc-500', r.kind === 'gap' && 'text-zinc-600')}>
          <span className="inline-block w-8 select-none text-right text-zinc-600">{r.line ?? ''}</span> {r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '} {r.text}
        </div>
      ))}
    </pre>
  );
}

function ToolCard({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const icon =
    item.status === 'running' ? <Loader2 size={12} className="animate-spin text-violet-300" /> : item.status === 'ok' ? <Check size={12} className="text-emerald-400" /> : item.status === 'denied' ? <X size={12} className="text-amber-400" /> : <AlertTriangle size={12} className="text-red-400" />;
  const d = item.display;
  let stats: string | undefined;
  if (d?.type === 'diff') {
    const rows = lineDiff(d.before, d.after, 0);
    stats = `+${rows.filter((r) => r.kind === 'add').length} −${rows.filter((r) => r.kind === 'del').length}`;
  }
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/70 text-xs">
      <button className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left" onClick={() => setOpen(!open)}>
        {icon}
        <span className="truncate font-medium text-zinc-200">{item.label}</span>
        {stats && <span className="text-zinc-500">{stats}</span>}
        {item.summary && !stats && <span className="truncate text-zinc-500">{item.summary}</span>}
        <span className="ml-auto text-zinc-600">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
      </button>
      {open && (
        <div className="border-t border-zinc-800 px-2.5 py-2">
          {d?.type === 'diff' ? <DiffView d={d} /> : <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] text-zinc-400">{item.content ?? ''}</pre>}
        </div>
      )}
    </div>
  );
}

function Todos({ todos }: { todos: Todo[] }) {
  if (!todos.length) return null;
  const done = todos.filter((t) => t.status === 'completed').length;
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-xs">
      <div className="mb-1 flex items-center justify-between text-zinc-400">
        <span className="font-medium">Plan</span>
        <span>
          {done}/{todos.length}
        </span>
      </div>
      {todos.map((t, i) => (
        <div key={i} className={cx('flex items-center gap-2 py-0.5', t.status === 'completed' && 'text-zinc-500 line-through', t.status === 'in_progress' && 'text-violet-200')}>
          {t.status === 'completed' ? <Check size={12} className="text-emerald-400" /> : t.status === 'in_progress' ? <Loader2 size={12} className="animate-spin text-violet-300" /> : <Circle size={10} className="text-zinc-600" />}
          {t.content}
        </div>
      ))}
    </div>
  );
}

function Approval({ approval }: { approval: PendingApproval }) {
  const [feedback, setFeedback] = useState('');
  const { request, resolve } = approval;
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
      <div className="mb-2 font-medium text-amber-200">
        Allow: {request.label} <span className="font-normal text-zinc-400">— {request.reason}</span>
      </div>
      {request.preview?.type === 'diff' && <DiffView d={request.preview} />}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => resolve({ allow: true })}>
          Allow
        </Button>
        {request.canRemember && <Button onClick={() => resolve({ allow: true, remember: true })}>Always allow</Button>}
        <Button onClick={() => resolve({ allow: false, feedback: feedback || undefined })}>Deny</Button>
        <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Optional feedback for the agent" className="min-w-40 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs" />
      </div>
    </div>
  );
}

export interface ChatProps {
  items: ChatItem[];
  todos: Todo[];
  running: boolean;
  approval: PendingApproval | null;
  canUndo: boolean;
  disabledReason?: string;
  onSend: (text: string) => void;
  onStop: () => void;
  onUndo: () => void;
}

export function Chat({ items, todos, running, approval, canUndo, disabledReason, onSend, onStop, onUndo }: ChatProps) {
  const [text, setText] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (stick) bottom.current?.scrollIntoView({ block: 'end' });
  }, [items, todos, approval, stick]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || running || disabledReason) return;
    onSend(t);
    setText('');
    setStick(true);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scroller}
        className="min-h-0 flex-1 space-y-2.5 overflow-auto px-4 py-4"
        onScroll={() => {
          const el = scroller.current!;
          setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
        }}
      >
        {!items.length && (
          <div className="mx-auto mt-10 max-w-md text-center">
            <h2 className="text-lg font-semibold text-zinc-100">What do you want to build?</h2>
            <p className="mt-1 text-sm text-zinc-400">Describe an app. The agent plans it, writes the code and checks the preview, on free models.</p>
            <div className="mt-5 space-y-1.5 text-left">
              {EXAMPLE_PROMPTS.map((p) => (
                <button key={p} onClick={() => setText(p)} className="block w-full rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-left text-xs text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800">
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
        {items.map((item) => {
          switch (item.kind) {
            case 'user':
              return (
                <div key={item.id} className="ml-10 whitespace-pre-wrap rounded-lg bg-violet-600/20 px-3 py-2 text-[13.5px] text-zinc-100">
                  {item.text}
                </div>
              );
            case 'assistant':
              return (
                <div key={item.id} className="px-1">
                  {item.reasoning && !item.text && <div className="mb-1 line-clamp-3 text-xs italic text-zinc-500">{item.reasoning}</div>}
                  <Markdown text={item.text} />
                  {item.streaming && (
                    <span className="ml-1 inline-flex gap-0.5 align-middle">
                      <span className="dot h-1.5 w-1.5 rounded-full bg-zinc-400" />
                      <span className="dot h-1.5 w-1.5 rounded-full bg-zinc-400" />
                      <span className="dot h-1.5 w-1.5 rounded-full bg-zinc-400" />
                    </span>
                  )}
                </div>
              );
            case 'tool':
              return <ToolCard key={item.id} item={item} />;
            case 'notice':
              return (
                <div key={item.id} className={cx('rounded-md px-3 py-1.5 text-xs', item.level === 'error' ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-200')}>
                  {item.text}
                </div>
              );
            case 'status':
              return (
                <div key={item.id} className="text-center text-[11px] text-zinc-500">
                  {item.text}
                </div>
              );
          }
        })}
        {approval && <Approval approval={approval} />}
        {running && !approval && items.at(-1)?.kind !== 'assistant' && (
          <div className="flex items-center gap-2 px-1 text-xs text-zinc-500">
            <Loader2 size={12} className="animate-spin" /> Working…
          </div>
        )}
        <div ref={bottom} />
      </div>
      <div className="border-t border-zinc-800 p-3">
        {todos.length > 0 && (
          <div className="mb-2">
            <Todos todos={todos} />
          </div>
        )}
        {disabledReason && <div className="mb-2 rounded-md bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">{disabledReason}</div>}
        <form onSubmit={submit} className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) submit(e);
            }}
            rows={Math.min(6, Math.max(1, text.split('\n').length))}
            placeholder={running ? 'The agent is working… (you can queue feedback after it stops)' : 'Describe what to build or change. Enter to send, Shift+Enter for a new line.'}
            className="min-h-9 flex-1 resize-none rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-violet-500"
          />
          {running ? (
            <Button variant="danger" type="button" onClick={onStop} title="Stop">
              <Square size={14} /> Stop
            </Button>
          ) : (
            <>
              <Button type="button" onClick={onUndo} disabled={!canUndo} title="Revert the last turn's file changes">
                <Undo2 size={14} />
              </Button>
              <Button variant="primary" type="submit" disabled={!text.trim() || !!disabledReason}>
                <Send size={14} /> Send
              </Button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
