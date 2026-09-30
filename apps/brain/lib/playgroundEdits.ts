/**
 * The format the playground model answers in, and the parser that turns it
 * into file changes. Plain tags rather than JSON: models write long files far
 * more reliably when they do not have to escape every quote and newline.
 *
 *   <message>What was done, in a sentence or two.</message>
 *   <file path="src/App.jsx">…the whole file…</file>
 *   <delete path="old.js" />
 *
 * Shared by the server (which parses) and the tests. Pure, no dependencies.
 */

export interface PlaygroundEdit {
    message: string;
    files: { path: string; content: string }[];
    deletes: string[];
}

/** A project-relative path: no leading slash, no "..", no drive letters, no URLs. */
export const SAFE_PATH = /^(?![/\\])(?!.*(?:^|\/)\.\.(?:\/|$))(?![A-Za-z]:)(?!.*:\/\/)[\w@.\-/ ]{1,200}$/;
const MAX_FILE = 200_000;
const MAX_FILES = 40;

function stripFence(content: string): string {
    // Models sometimes wrap a file's content in a code fence inside the tag.
    const fenced = /^\s*```[\w-]*\n([\s\S]*?)\n```\s*$/.exec(content);
    return (fenced ? fenced[1]! : content).replace(/^\n/, '');
}

export function parseEdit(text: string): PlaygroundEdit {
    const files: PlaygroundEdit['files'] = [];
    const deletes: string[] = [];
    const seen = new Set<string>();

    for (const match of text.matchAll(/<file\s+path="([^"]+)"\s*>([\s\S]*?)<\/file>/g)) {
        const path = match[1]!.trim();
        if (!SAFE_PATH.test(path) || seen.has(path) || files.length >= MAX_FILES) continue;
        const content = stripFence(match[2]!);
        if (content.length > MAX_FILE) continue;
        seen.add(path);
        files.push({ path, content: content.endsWith('\n') ? content : `${content}\n` });
    }
    for (const match of text.matchAll(/<delete\s+path="([^"]+)"\s*\/?>/g)) {
        const path = match[1]!.trim();
        if (SAFE_PATH.test(path) && !seen.has(path)) deletes.push(path);
    }

    const tagged = /<message>([\s\S]*?)<\/message>/.exec(text)?.[1]?.trim();
    // Without a message tag, whatever prose surrounds the files is the message.
    const message =
        tagged ||
        text
            .replace(/<file\s+path="[^"]+"\s*>[\s\S]*?<\/file>/g, '')
            .replace(/<delete\s+path="[^"]+"\s*\/?>/g, '')
            .trim()
            .slice(0, 2_000) ||
        (files.length ? `Updated ${files.length} file${files.length === 1 ? '' : 's'}.` : 'No changes were made.');

    return { message, files, deletes };
}
