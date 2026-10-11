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
