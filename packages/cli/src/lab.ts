import { exec } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { AgentEvent } from '@agentic/core';
import { createLocalAgent, type AgenticConfig } from '@agentic/core/node';
import { c, line } from './ui';

/**
 * `agentic lab`: runs the Test lab's tasks with no person present (for the
 * nightly run), each in a fresh folder with commands allowed, then runs the
 * task's automatic checks and sends the result to the Test lab like the
 * extension does. Needs LAB_TOKEN; the site is FAC_SITE or the live one.
 */

const SITE = (process.env.FAC_SITE ?? 'https://brain-rho-roan.vercel.app').replace(/\/$/, '');

interface Grader {
  step: number;
  type: string;
  command?: string;
  timeout?: number;
}

interface Task {
  id: string;
  title: string;
  category: string;
  prompts: string[];
  files: Record<string, string>;
  graders?: Grader[];
}

interface Turn {
  prompt: string;
  reason: string;
  durationMs: number;
  tokens: number;
  steps: number;
  requests: number;
  models: string[];
  filesChanged: string[];
  usedFyx: boolean;
}

export async function runLab(config: AgenticConfig, opts: { model?: string; only?: string[]; version: string }): Promise<number> {
  const token = process.env.LAB_TOKEN?.trim();
  if (!token) {
    line(c.red('Set LAB_TOKEN: copy it from the Test lab page in the admin panel.'));
    return 1;
  }
  const response = await fetch(`${SITE}/api/lab/tasks`, { headers: { 'x-lab-token': token }, signal: AbortSignal.timeout(15_000) });
  const body = (await response.json().catch(() => ({}))) as { tasks?: Task[]; error?: string };
  if (!response.ok || !body.tasks) {
    line(c.red(`Could not load the test tasks: ${body.error ?? `HTTP ${response.status}`}`));
    return 1;
  }
  // By default only the benchmarks: they have a checklist to grade against.
  const tasks = body.tasks.filter((t) => (opts.only?.length ? opts.only.includes(t.id) : t.id.startsWith('bench-')));
  let failures = 0;
  for (const task of tasks) {
    line(c.bold(`▶ ${task.title}`));
    try {
      const turns: Turn[] = [];
      let transcript = '';
      const root = await mkdtemp(path.join(tmpdir(), `fac-lab-${task.id}-`));
      for (const [file, content] of Object.entries(task.files)) {
        const target = path.join(root, file);
        if (!target.startsWith(root)) continue;
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content, 'utf8');
      }
      const local = await createLocalAgent({ cwd: root, config, model: opts.model, mode: 'auto', approve: async () => ({ allow: true }) });
      try {
        for (const prompt of task.prompts) {
          const turn = await runPrompt(local.agent.run(prompt), prompt);
          turns.push(turn.turn);
          transcript += `## You\n${prompt}\n\n## Agent\n${turn.text}\n\n`;
          line(c.dim(`  ${turn.turn.reason} · ${turn.turn.steps} steps · ${turn.turn.tokens.toLocaleString('en-US')} tokens · ${Math.round(turn.turn.durationMs / 1000)} s`));
        }
      } finally {
        local.processes.killAll();
      }
      const checks = await runChecks(root, task.graders ?? []);
      if (checks.length) line(c.dim(`  ${checks.filter((x) => x.passed).length} of ${checks.length} automatic checks passed`));
      const sent = await fetch(`${SITE}/api/lab/results`, {
        method: 'POST',
        headers: { 'x-lab-token': token, 'content-type': 'application/json' },
        body: JSON.stringify({ taskId: task.id, title: task.title, category: task.category, extension: `cli-${opts.version}`, turns, transcript, checks }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!sent.ok) throw new Error(`could not send the result: HTTP ${sent.status}`);
    } catch (error) {
      failures++;
      line(c.red(`  ${(error as Error).message}`));
    }
  }
  return failures ? 1 : 0;
}

async function runPrompt(events: AsyncIterable<AgentEvent>, prompt: string): Promise<{ turn: Turn; text: string }> {
  const started = Date.now();
  const models = new Set<string>();
  const files = new Set<string>();
  let tokens = 0;
  let requests = 0;
  let steps = 0;
  let reason = 'error';
  let text = '';
  for await (const ev of events) {
    if (ev.type === 'model') {
      models.add(ev.ref);
      requests++;
    } else if (ev.type === 'usage') {
      tokens = ev.total.inputTokens + ev.total.outputTokens;
    } else if (ev.type === 'text') {
      text += ev.delta;
    } else if (ev.type === 'reset') {
      text = '';
    } else if (ev.type === 'tool_end' && (ev.call.name === 'write_file' || ev.call.name === 'edit_file') && typeof ev.call.args.path === 'string' && !ev.result.isError) {
      files.add(ev.call.args.path);
    } else if (ev.type === 'done') {
      reason = ev.reason;
      steps = ev.steps;
    }
  }
  return {
    turn: { prompt, reason, durationMs: Date.now() - started, tokens, steps, requests, models: [...models].slice(0, 10), filesChanged: [...files], usedFyx: false },
    text: text.slice(-20_000),
  };
}

/** One at a time: a check may rebuild what another one reads. */
async function runChecks(cwd: string, graders: Grader[]): Promise<{ step: number; passed: boolean; output: string }[]> {
  const results: { step: number; passed: boolean; output: string }[] = [];
  for (const g of graders) {
    if (g.type !== 'command' || !g.command) continue;
    results.push(
      await new Promise((resolve) => {
        exec(g.command!, { cwd, timeout: Math.min(g.timeout ?? 120, 900) * 1000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
          const out = `${stdout}\n${stderr}`.trim() || error?.message || '';
          resolve({ step: g.step, passed: !error, output: out.length > 600 ? `…${out.slice(-600)}` : out });
        });
      }),
    );
  }
  return results;
}
