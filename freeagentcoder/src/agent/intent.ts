/** A request to make something new, not to change what is there: "create a ppt on…", "build a chatbot…". */
export function asksForSomethingNew(prompt: string): boolean {
    const text = prompt.toLowerCase();
    const making =
        /\b(?:create|build|make|generate|write|design|develop|set\s*up|start)\s+(?:me\s+|us\s+)?(?:a|an|new|my\s+(?:own|first))\b/.test(text) ||
        /\bi\s+(?:need|want)\s+(?:a|an)\b/.test(text);
    const changing =
        /\b(?:fix|bug|error|update|change|modify|refactor|improve|existing|my\s+(?:code|project|app|site|repo)|this\s+(?:code|project|app|file|repo)|in\s+(?:the|this)\s+(?:file|project|repo|folder))\b/.test(
            text,
        );
    return making && !changing;
}

/**
 * A question about the world rather than this project ("what is a closure",
 * "how does OAuth work"): answered from knowledge, with no tools and no project
 * context. Anything that points at the project, a file, or the conversation is not.
 */
export function isGeneralQuestion(prompt: string): boolean {
    const text = prompt.trim();
    const words = text.split(/\s+/).length;
    if (words < 3 || words > 40) {
        return false;
    }
    const asking = /^(?:what|why|how|when|which|who|explain|describe|define|compare|difference|is|are|can|does|do|should)\b/i.test(text) || text.endsWith('?');
    const local =
        /\b(?:my|our|this|these|those|that|it|its|here|you|your|above|earlier|previous|again|project|repo|repository|codebase|folder|file|files|function|class|component|module|page|error|bug|crash|failing|install|run|build|fix|change|add|create|make|write|update)\b|@\S|\b[\w-]+\.(?:[cm]?[jt]sx?|py|cs|java|go|rs|rb|php|md|json|ya?ml|html|css|sql|toml)\b|[/\\]/i.test(text);
    return asking && !local;
}

/**
 * Greetings, thanks and acknowledgements ("hi", "thanks!", "ok", "." or an
 * emoji): nothing to do in the project, so they get a short friendly reply
 * from a tiny prompt instead of the whole coding agent.
 */
export function isSmallTalk(prompt: string): boolean {
    const text = prompt.trim().toLowerCase();
    if (!text) {
        return false;
    }
    if (/^[\p{P}\p{S}\s]+$/u.test(text)) {
        return true;
    }
    if (text.split(/\s+/).length > 6) {
        return false;
    }
    return /^(?:hi+|hey+|hello+|hii+|yo|sup|hola|namaste|good\s+(?:morning|afternoon|evening|night)|gm|thanks?(?:\s+you)?|thank\s+you|thx|ty|tysm|cool|nice|great|awesome|perfect|ok(?:ay)?|k|kk|sure|got\s+it|alright|lol|haha+|bye|see\s+you|cheers|wow|yes|no|yep|nope|how\s+are\s+you|who\s+are\s+you|what\s+can\s+you\s+do)(?:\s+(?:there|man|dude|bro|buddy|mate|again|so\s+much|a\s+lot|freeagentcoder))*[\s\p{P}\p{S}]*$/u.test(text);
}

/** The whole system prompt for small talk and general questions: no tools, no project, a few hundred tokens at most. */
export const CHAT_SYSTEM = [
    'You are FreeAgentCoder, a friendly AI coding agent inside VS Code that plans, edits, runs and tests code in the open project.',
    'This message needs no project work: reply in one to three short, warm, natural sentences, matching the user’s tone and language. For a greeting, say hi and offer to help with their code (build, fix, explain or test). For a general question, answer it accurately and briefly.',
    'No emoji unless the user uses them. Never claim to have looked at or changed their files in this reply.',
].join(' ');
