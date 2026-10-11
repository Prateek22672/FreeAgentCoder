import { exec } from 'node:child_process';

/**
 * Runs a test task's command graders in the test folder once its prompts are
 * done: each command passes when it exits with 0. Only the admin's own lab
 * tasks have graders, and only the "Run a test task" command runs them.
 */

export interface CommandGrader {
    step: number;
    type: string;
    command?: string;
    timeout?: number;
}

export interface CheckResult {
    step: number;
    passed: boolean;
    output: string;
}

const MAX_OUTPUT = 600;

export async function runCommandGraders(root: string, graders: CommandGrader[] = []): Promise<CheckResult[]> {
    const results: CheckResult[] = [];
    for (const grader of graders) {
        if (grader.type !== 'command' || !grader.command) {
            continue;
        }
        results.push(await runOne(root, grader.step, grader.command, Math.min(grader.timeout ?? 120, 900) * 1000));
    }
    return results;
}

function runOne(cwd: string, step: number, command: string, timeout: number): Promise<CheckResult> {
    return new Promise((resolve) => {
        exec(command, { cwd, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
            const text = `${stdout}\n${stderr}`.trim();
            resolve({ step, passed: !error, output: tail(error && !text ? error.message : text) });
        });
    });
}

/** The end of the output, where results and errors usually are. */
function tail(text: string): string {
    return text.length > MAX_OUTPUT ? `…${text.slice(-MAX_OUTPUT)}` : text;
}
