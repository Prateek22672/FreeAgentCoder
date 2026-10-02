import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { evaluateGates, reviewMessage, type CommandRun, type GateResult, type Playbook } from './playbooks';

/**
 * Quality gates against the project as it really is. A gate such as "the
 * production build passes" only means something where there is a build: a
 * game written as plain HTML, CSS and JavaScript has none, and holding the
 * agent to it sends it off to invent a build system. So before a gate is
 * required, the files beside what the task changed are checked for the
 * manifest that would make it real.
 */

/** The names of the files beside the changed ones, in their folders and every folder up to the project root. */
export async function filesNear(root: string, touched: Iterable<string>): Promise<Set<string>> {
    const base = path.resolve(root);
    const folders = new Set<string>([base]);
    for (const file of touched) {
        let dir = path.dirname(path.resolve(base, file));
        // Stop at the root; a file outside the project adds nothing.
        while (!folders.has(dir) && !path.relative(base, dir).startsWith('..') && !path.isAbsolute(path.relative(base, dir))) {
            folders.add(dir);
            dir = path.dirname(dir);
        }
    }
    const names = new Set<string>();
    await Promise.all(
        [...folders].map(async (dir) => {
            for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
                names.add(name);
            }
        }),
    );
    return names;
}

/** How each gate stands for this task, with gates that cannot apply here not required. */
export async function gateResults(playbooks: Playbook[], runs: CommandRun[], release: boolean, root: string, touched: Iterable<string>): Promise<GateResult[]> {
    return evaluateGates(playbooks, runs, release, await filesNear(root, touched));
}

/** A message sending the agent back to work, or undefined when it may finish. */
export async function completionReview(
    playbooks: Playbook[],
    runs: CommandRun[],
    release: boolean,
    root: string,
    touched: Iterable<string>,
    finalReply: string,
): Promise<string | undefined> {
    return reviewMessage(await gateResults(playbooks, runs, release, root, touched), finalReply);
}
