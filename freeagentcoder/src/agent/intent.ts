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
