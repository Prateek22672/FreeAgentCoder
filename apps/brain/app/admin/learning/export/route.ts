import { isSignedIn } from '@/lib/admin';
import { listErrors, listLessons } from '@/lib/learning';
import { listResults, readResult, readTasks } from '@/lib/lab';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SYSTEM = 'You are FreeAgentCoder, an AI coding agent in VS Code. Avoid known mistakes and fix problems at their root cause.';

/**
 * The fine-tuning set, as JSON Lines in the chat format most services take
 * (OpenAI, Together, Fireworks, and LoRA trainers such as Unsloth):
 *
 * - approved shared lessons and error rules, as short teaching examples;
 * - our own Test lab runs that scored well, kept whole for curation into
 *   step-by-step examples. These are our tasks, not users' work.
 *
 * Nothing from users' code, files or prompts is in it.
 */
export async function GET(): Promise<Response> {
    if (!(await isSignedIn())) return new Response('Sign in first.', { status: 401 });
    const [lessons, errors, tasks, results] = await Promise.all([
        listLessons().catch(() => []),
        listErrors().catch(() => []),
        readTasks(),
        listResults(),
    ]);
    const lines: string[] = [];
    const chat = (user: string, assistant: string, source: string) =>
        lines.push(JSON.stringify({ source, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }, { role: 'assistant', content: assistant }] }));

    for (const l of lessons.filter((x) => x.status === 'approved')) {
        chat(`Before starting${l.stack ? ` a ${l.stack} task` : ' a task'}, what rule should you follow that users have had to correct before?`, l.text, 'lesson');
    }
    for (const e of errors.filter((x) => x.status === 'approved' && x.draft_rule)) {
        chat(`A step failed, and the same error came back after a fix:\n${e.signature}\nWhat do you do now?`, `Find the root cause before changing anything else. ${e.draft_rule}`, 'error_rule');
    }
    for (const summary of results) {
        const task = tasks.find((t) => t.id === summary.taskId);
        const steps = task?.checklist?.length ?? 0;
        const passed = summary.rating?.passed?.length ?? 0;
        const good = steps ? passed / steps >= 0.8 : (summary.rating?.quality ?? 0) >= 4;
        if (!good) continue;
        const run = await readResult(summary.id);
        if (!run) continue;
        lines.push(JSON.stringify({ source: 'benchmark', task: run.title, prompts: run.turns.map((t) => t.prompt), score: steps ? `${passed}/${steps}` : `quality ${run.rating?.quality}`, transcript: run.transcript }));
    }
    return new Response(lines.join('\n') + (lines.length ? '\n' : ''), {
        headers: {
            'content-type': 'application/x-ndjson; charset=utf-8',
            'content-disposition': `attachment; filename="freeagentcoder-training-${new Date().toISOString().slice(0, 10)}.jsonl"`,
            'cache-control': 'no-store',
        },
    });
}
