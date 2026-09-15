import type { ImagePart, Message, ModelRouter } from '@agentic/core';

/**
 * The "reader" models: a vision model describes screenshots and scanned PDFs,
 * and a long-context model condenses very long documents, before the coding
 * agent starts. The agent then works from exact text, whichever model it ends
 * up on.
 */

const IMAGE_READER_SYSTEM = `You are the attachment reader for a coding agent that may not be able to see images. Your description may be all it knows about them, so be exact and complete, and never guess.
For each image, under a heading "### Image N: <name>":
1. What it is: app screenshot, error dialog, terminal output, design mockup, diagram, document photo, logo, etc.
2. All visible text, verbatim: error messages, stack traces, code, labels, URLs, numbers. Use code blocks for code, logs and errors.
3. Layout and UI: components and where they are, sizes, colors (hex if you can tell), alignment, spacing, states (selected, disabled, loading).
4. Anything highlighted, circled, arrowed, crossed out or annotated. This is usually what the user wants changed, so say precisely what it points at.
5. Visible problems: overlaps, cut-off or overflowing text, misalignment, wrong colors, broken images, empty states, error states.
Describe only. Don't suggest fixes or write code.`;

const DIGEST_SYSTEM = `You condense a long document for a coding agent that will implement from it. Keep every specific detail that matters for building: names, numbers, limits, field names, endpoints, rules, acceptance criteria and wording the user must see. Don't invent anything.
Format:
## Purpose
## Requirements (numbered, one per line, exact)
## Data, APIs, screens and names mentioned
## Constraints and non-goals
## Open questions or contradictions`;

const PDF_PROMPT = `Transcribe this PDF for a coding agent. Keep reading order and mark pages with "--- Page N ---". Reproduce all text exactly, tables as Markdown tables, and describe figures, diagrams and UI mockups in detail (layout, labels, colors, arrows). Don't summarize or skip anything.`;

export interface ReadResult {
    text: string;
    model?: string;
}

/** Runs one request through a model chain (with its failover) and returns the reply text. */
export async function complete(router: ModelRouter, system: string, content: string, signal?: AbortSignal, images?: ImagePart[]): Promise<ReadResult> {
    const message: Message = images?.length ? { role: 'user', content, images } : { role: 'user', content };
    const stream = router.stream({ system, messages: [message], tools: [], signal, temperature: 0.2 });
    let step = await stream.next();
    while (!step.done) {
        step = await stream.next();
    }
    return { text: step.value.content.trim(), model: step.value.model };
}

export function describeImages(router: ModelRouter, images: ImagePart[], request: string, signal?: AbortSignal): Promise<ReadResult> {
    const names = images.map((image, i) => `${i + 1}. ${image.name ?? `image ${i + 1}`}`).join('\n');
    return complete(
        router,
        IMAGE_READER_SYSTEM,
        `The user's message, for context only:\n"""${request.slice(0, 4_000)}"""\n\nAttached images, in order:\n${names}\n\nDescribe them.`,
        signal,
        images,
    );
}

export function digestDocument(router: ModelRouter, name: string, text: string, request: string, signal?: AbortSignal): Promise<ReadResult> {
    return complete(router, DIGEST_SYSTEM, `Document: ${name}\nThe user's request, for context: """${request.slice(0, 2_000)}"""\n\n<document>\n${text}\n</document>`, signal);
}

/** Gemini reads PDFs natively, including scanned pages without a text layer. */
export async function readPdfWithGemini(opts: {
    apiKey: string;
    model: string;
    bytes: Uint8Array;
    name: string;
    request: string;
    signal?: AbortSignal;
}): Promise<ReadResult & { inputTokens: number; outputTokens: number }> {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
        body: JSON.stringify({
            contents: [
                {
                    role: 'user',
                    parts: [
                        { inline_data: { mime_type: 'application/pdf', data: Buffer.from(opts.bytes).toString('base64') } },
                        { text: `${PDF_PROMPT}\n\nFile: ${opts.name}\nThe user's request, for context: """${opts.request.slice(0, 2_000)}"""` },
                    ],
                },
            ],
            generationConfig: { temperature: 0.1, maxOutputTokens: 16_384 },
        }),
        signal: opts.signal,
    });
    const json = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    if (!response.ok) {
        throw new Error(`gemini: ${json.error?.message ?? `HTTP ${response.status}`}`);
    }
    const text = (json.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? '').join('');
    return {
        text: text.trim(),
        model: `gemini:${opts.model}`,
        inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    };
}
