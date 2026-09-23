import { AllProvidersFailedError, ContextTooLargeError, type ModelRouter } from '@agentic/core';
import { EVIDENCE_RULES, buildEvidenceBlock, checkCitations, excerpt, extractTerms, isSecretFile, rankHits, redactSecrets, roleOf } from '@agentic/project-brain';
import { getRouter, providerLabel, routerForKey } from '@/lib/ai';
import { refundTrial, trialStatus, useTrial } from '@/lib/trial';
import { fail, isResponse, readBody, requireBrain } from '@/lib/http';
import type { Brain } from '@/lib/store';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * The files most likely to answer the question, as excerpts with real line
 * numbers. Secret files are never included, and anything credential-shaped in
 * the rest is redacted: excerpts leave this server for a model provider.
 */
function gatherEvidence(brain: Brain, question: string) {
    const flagged = new Set(brain.secrets.map((s) => s.path));
    const allowed = (path: string) => !isSecretFile(path) && !flagged.has(path);
    const hits = rankHits(brain.index.search(question, 60), question, 30)
        .filter((hit) => allowed(hit.path))
        .slice(0, 12);
    const excerpts = hits.flatMap((hit) => {
        const file = brain.byPath.get(hit.path);
        return file ? [excerpt(file, hit.start, hit.end, 3)] : [];
    });

    // A file whose name matches ("UserService") is often the answer even when its text scores low.
    const terms = extractTerms(question).map((t) => t.toLowerCase());
    const named = brain.input.files
        .filter((f) => allowed(f.path) && terms.some((t) => f.path.toLowerCase().includes(t)) && !hits.some((h) => h.path === f.path))
        .slice(0, 4);
    for (const file of named) excerpts.push(excerpt(file, 1, Math.min(80, file.text.split('\n').length), 0));

    return { excerpts: excerpts.map((e) => ({ ...e, text: redactSecrets(e.text) })), searched: hits.length };
}

/** A compact map of the repository, so the model can name files it wasn't shown. */
function fileList(brain: Brain, limit = 350): string {
    const priority: Record<string, number> = { api: 0, service: 1, model: 2, component: 3, other: 4, test: 5, config: 6, doc: 7, style: 8 };
    const paths = [...brain.known].sort((a, b) => (priority[roleOf(a)] ?? 9) - (priority[roleOf(b)] ?? 9) || a.localeCompare(b));
    const shown = paths.slice(0, limit);
    return `${shown.join('\n')}${paths.length > limit ? `\n… and ${paths.length - limit} more files` : ''}`;
}

function stackLine(brain: Brain): string {
    const a = brain.analysis;
    const parts = [
        a.languages.filter((l) => l.share > 0).slice(0, 3).map((l) => l.name).join(', '),
        a.frameworks.map((f) => f.value).join(', '),
        a.databases.map((d) => d.value).join(', '),
        a.packageManager?.value,
    ].filter(Boolean);
    return parts.join(' · ');
}

export async function POST(request: Request) {
    const body = await readBody<{ id?: string; question?: string }>(request);
    const brain = requireBrain(body?.id);
    if (isResponse(brain)) return brain;
    const question = typeof body?.question === 'string' ? body.question.trim().slice(0, 2_000) : '';
    if (!question) return fail('Ask a question about this repository.');

    // Who pays for this question: the visitor's own key, or one of the site's free trial questions.
    const ownProvider = request.headers.get('x-brain-provider');
    const ownKey = request.headers.get('x-brain-key');
    let router: ModelRouter | undefined;
    let access: { mode: 'own'; provider: string } | { mode: 'trial'; remaining: number; limit: number };
    let setCookie: string | undefined;
    let trialVisitor: string | undefined;
    if (ownProvider && ownKey) {
        router = routerForKey(ownProvider, ownKey);
        if (!router) return fail('That key does not look right. Paste the whole key, and pick the provider it came from.', 400, { badKey: true });
        access = { mode: 'own', provider: providerLabel(ownProvider) };
    } else {
        router = getRouter();
        if (!router) return fail('Add your own free AI key to ask questions. It takes about a minute.', 402, { needKey: true, reason: 'no-server-key' });
        const trial = trialStatus(request);
        setCookie = trial.setCookie;
        if (trial.remaining <= 0) {
            return fail(
                trial.closed
                    ? "Today's free questions on this site are used up. Add your own free key to keep asking — it takes about a minute."
                    : "You've used today's free questions. Add your own free key to keep asking — it takes about a minute.",
                402,
                { needKey: true, reason: 'trial-used' },
            );
        }
        useTrial(request, trial.visitorId);
        trialVisitor = trial.visitorId;
        access = { mode: 'trial', remaining: trial.remaining - 1, limit: trial.limit };
    }
    /** Provider errors can quote the request; make sure a visitor's key never comes back in one. */
    const scrub = (text: string) => (ownKey ? text.split(ownKey).join('[your key]') : text);

    const meta = brain.analysis.meta;
    const { excerpts } = gatherEvidence(brain, question);
    const system = [
        `You are Project Brain. You explain the GitHub repository ${meta.owner}/${meta.repo} (branch ${meta.ref}) to a developer.`,
        `Detected stack: ${stackLine(brain) || 'unknown'}.`,
        EVIDENCE_RULES,
        'Format: short Markdown. Lead with the direct answer in one or two sentences, then the files that prove it as a list with what each one does. No filler, no generic advice that is not about this repository.',
    ].join('\n\n');

    const user = [
        `Question: ${question}`,
        '',
        '<repository_excerpts>',
        buildEvidenceBlock(excerpts) || '(no matching excerpts)',
        '</repository_excerpts>',
        '',
        '<repository_files>',
        fileList(brain),
        '</repository_files>',
    ].join('\n');

    const encoder = new TextEncoder();
    const abort = new AbortController();
    request.signal.addEventListener('abort', () => abort.abort());

    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            send({ type: 'evidence', files: [...new Set(excerpts.map((e) => e.path))], access });
            let text = '';
            let model = '';
            try {
                const events = router.stream({ system, messages: [{ role: 'user', content: user }], tools: [], signal: abort.signal });
                let next = await events.next();
                while (!next.done) {
                    const event = next.value;
                    if (event.type === 'text') {
                        text += event.delta;
                        send({ type: 'text', delta: event.delta });
                    } else if (event.type === 'model') {
                        model = event.ref;
                        send({ type: 'model', ref: event.ref });
                    } else if (event.type === 'reset') {
                        text = '';
                        send({ type: 'reset' });
                    }
                    next = await events.next();
                }
                const final = next.value.content || text;
                // The contract: every path in the answer is checked against the ingested files.
                send({ type: 'done', model, grounding: checkCitations(final, brain.known) });
            } catch (error) {
                const raw = error instanceof Error ? error.message : String(error);
                if (trialVisitor) refundTrial(request, trialVisitor);
                let message: string;
                if (abort.signal.aborted) message = 'Stopped.';
                else if (error instanceof ContextTooLargeError) message = 'The question needs more context than the model accepts. Ask about a narrower part of the code.';
                else if (access.mode === 'own' && /\b40[13]\b|invalid|not valid|valid api key|unauthori[sz]ed|permission|api[_ ]key/i.test(raw)) {
                    message = `Your ${access.provider} key was rejected. Check that you copied all of it, or create a new one — it's free.`;
                } else if (/rate limit|quota|too many requests|\b429\b|per day|exhausted/i.test(raw)) {
                    message = access.mode === 'own'
                        ? `Your ${access.provider} key has reached its free limit for now. Try again later, or add a key from a different provider.`
                        : "The site's free model is busy right now. Add your own free key to keep going without waiting.";
                } else if (error instanceof AllProvidersFailedError) message = `The model could not answer:\n${scrub(raw.split('\n').slice(1).join('\n'))}`;
                else message = 'The model call failed. Try again in a moment.';
                // Never log a visitor's key, and never log their question.
                if (!(error instanceof AllProvidersFailedError) && !abort.signal.aborted) console.error('[brain ask]', scrub(raw).slice(0, 300));
                send({ type: 'error', message });
            } finally {
                controller.close();
            }
        },
    });

    const headers = new Headers({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
    if (setCookie) headers.set('Set-Cookie', setCookie);
    return new Response(stream, { headers });
}
