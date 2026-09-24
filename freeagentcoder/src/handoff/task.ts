/**
 * Tasks handed over from Project Brain through a vscode:// link.
 *
 * Anyone can craft such a link, so the task is treated as untrusted: it is
 * validated by the shared decoder, and it is only ever written into the chat
 * input for the user to read. Nothing runs until they press Send, and the
 * normal permission rules still apply to everything the agent then does.
 */
import { decodeTask, type ProjectTask } from './decode';

export type HandoffResult = { ok: true; task: ProjectTask; note: string } | { ok: false; error: string };

/**
 * Parse `vscode://<publisher.name>/task?p=<payload>` and work out what to tell
 * the user, given the name of the folder that is open (if any).
 */
export function readHandoff(path: string, query: string, openFolder: string | undefined): HandoffResult {
    if (path !== '/task') {
        return { ok: false, error: 'FreeAgentCoder does not recognise that link.' };
    }
    const payload = new URLSearchParams(query).get('p');
    if (!payload) {
        return { ok: false, error: 'The task link is empty.' };
    }
    const task = decodeTask(payload);
    if ('error' in task) {
        return { ok: false, error: task.error };
    }

    const repoName = task.repo.split('/')[1] ?? task.repo;
    let note: string;
    if (!openFolder) {
        note = `Task from Project Brain for ${task.repo}. Open that project's folder, then review the task and press Send.`;
    } else if (openFolder.toLowerCase() !== repoName.toLowerCase()) {
        note = `Task from Project Brain for ${task.repo}, but the open folder is "${openFolder}". Check it is the same project before you send.`;
    } else {
        note = `Task from Project Brain for ${task.repo}. Review it, then press Send.`;
    }
    return { ok: true, task, note };
}
