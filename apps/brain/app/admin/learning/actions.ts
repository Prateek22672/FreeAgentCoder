'use server';

import { revalidatePath } from 'next/cache';
import { isSignedIn } from '@/lib/admin';
import { getRouter } from '@/lib/ai';
import { completeText } from '@/lib/references';
import { failingSteps, listResults, readTasks } from '@/lib/lab';
import { isShareableRule, proposeLesson, setErrorRule, setFyxStatus, setLessonStatus } from '@/lib/learning';

const PATH = '/admin/learning';

export async function lessonAction(form: FormData): Promise<void> {
    if (!(await isSignedIn())) return;
    const hash = String(form.get('hash') ?? '');
    const decision = String(form.get('decision') ?? '');
    const edited = String(form.get('text') ?? '').trim();
    if (!hash || !['approved', 'rejected', 'pending'].includes(decision)) return;
    await setLessonStatus(hash, decision as 'approved' | 'rejected' | 'pending', edited && isShareableRule(edited) ? edited : undefined);
    revalidatePath(PATH);
}

export async function fyxAction(form: FormData): Promise<void> {
    if (!(await isSignedIn())) return;
    const pattern = String(form.get('pattern') ?? '');
    const decision = String(form.get('decision') ?? '');
    if (!pattern || !['approved', 'rejected', 'pending'].includes(decision)) return;
    await setFyxStatus(pattern, decision as 'approved' | 'rejected' | 'pending');
    revalidatePath(PATH);
}

const DRAFT_SYSTEM = 'You write short, general rules for an AI coding agent so it avoids a mistake it keeps repeating. One rule, under 35 words, true for any project, no names or paths. Answer with the rule only.';

/** Has a model draft the rule that would prevent a recurring error; the admin edits and approves it. */
export async function draftRuleAction(form: FormData): Promise<void> {
    if (!(await isSignedIn())) return;
    const signature = String(form.get('signature') ?? '');
    const tool = String(form.get('tool') ?? '');
    const stack = String(form.get('stack') ?? '');
    const router = getRouter();
    if (!signature || !router) return;
    const reply = await completeText(
        router,
        DRAFT_SYSTEM,
        `This error keeps coming back in coding agent runs, even after attempted fixes:\n${signature}\nTool: ${tool || 'unknown'}. Stack: ${stack || 'unknown'}.\nWrite the rule that prevents it at its root cause.`,
        AbortSignal.timeout(60_000),
    ).catch(() => '');
    const rule = reply.replace(/^["'\s-]+|["'\s]+$/g, '').replace(/\s+/g, ' ').slice(0, 240);
    if (rule) await setErrorRule(signature, { draft_rule: rule, status: 'drafted' });
    revalidatePath(PATH);
}

export async function errorAction(form: FormData): Promise<void> {
    if (!(await isSignedIn())) return;
    const signature = String(form.get('signature') ?? '');
    const decision = String(form.get('decision') ?? '');
    const rule = String(form.get('rule') ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!signature) return;
    if (decision === 'approved') {
        if (!rule || !isShareableRule(rule)) return;
        await setErrorRule(signature, { draft_rule: rule, status: 'approved' });
    } else if (decision === 'ignored' || decision === 'new') {
        await setErrorRule(signature, { status: decision });
    } else if (decision === 'save') {
        await setErrorRule(signature, { draft_rule: rule, status: rule ? 'drafted' : 'new' });
    }
    revalidatePath(PATH);
}

const TUNE_SYSTEM =
    'You improve the instructions of an AI coding agent. Given a check it keeps failing in benchmark runs, write one general rule that makes it pass: under 35 words, true for any project of that kind, no names or paths. Answer with the rule only.';

/** Instruction tuning: a model drafts the rule for a step the nightly benchmarks keep failing; it waits in the lessons queue. */
export async function tuneAction(form: FormData): Promise<void> {
    if (!(await isSignedIn())) return;
    const taskId = String(form.get('taskId') ?? '');
    const step = Number(form.get('step'));
    const router = getRouter();
    if (!taskId || !Number.isInteger(step) || !router) return;
    const [tasks, results] = await Promise.all([readTasks(), listResults()]);
    const failing = failingSteps(tasks, results).find((f) => f.taskId === taskId && f.step === step);
    const task = tasks.find((t) => t.id === taskId);
    if (!failing || !task) return;
    const reply = await completeText(
        router,
        TUNE_SYSTEM,
        `Task given to the agent: ${task.prompts[0]?.slice(0, 600) ?? task.title}\nCheck it failed in ${failing.failed} of ${failing.graded} runs: ${failing.text}\n${failing.notes.length ? `What the check saw: ${failing.notes.join(' | ')}\n` : ''}Write the rule.`,
        AbortSignal.timeout(60_000),
    ).catch(() => '');
    const rule = reply.replace(/^["'\s-]+|["'\s]+$/g, '').replace(/\s+/g, ' ').slice(0, 240);
    if (rule) await proposeLesson(rule, task.category === 'ml' ? 'python' : '');
    revalidatePath(PATH);
}
