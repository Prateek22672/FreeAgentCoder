import type { ApprovalDecision, ApprovalRequest } from '@agentic/core';
import { diffStats, renderDiff } from './render';
import type { Terminal } from './terminal';
import { c, line, width } from './ui';

/** Ask the user about a write, command or fetch. */
export async function askApproval(term: Terminal, req: ApprovalRequest): Promise<ApprovalDecision> {
  if (!term.interactive) return { allow: false, feedback: 'No terminal to approve from. Run with --mode auto to allow this.' };

  line();
  line(`${c.yellow('?')} ${c.bold(req.label)} ${c.dim(`— ${req.reason}`)}`);
  if (req.outsideProject) line(c.yellow(`  Outside the project folder: ${req.paths.join(', ')}`));

  const p = req.preview;
  if (p?.type === 'diff') {
    line(`  ${diffStats(p)}`);
    for (const l of renderDiff(p, 30)) line(`    ${l}`);
  } else if (p?.type === 'command') {
    line(`  ${c.cyan('$')} ${p.command}`);
  } else if (req.url) {
    line(`  ${c.cyan(req.url)}`);
  }

  const options = [`${c.bold('y')}es`, `${c.bold('n')}o`];
  if (req.canRemember) options.push(`${c.bold('a')}lways`);
  options.push(`or type feedback`);
  const answer = await term.ask(`  Allow? ${c.dim(`(${options.join(' / ')})`)} `);
  if (answer === null) return { allow: false, feedback: 'Interrupted.' };

  const a = answer.trim().toLowerCase();
  if (a === '' || a === 'y' || a === 'yes') return { allow: true };
  if (req.canRemember && (a === 'a' || a === 'always')) return { allow: true, remember: true };
  if (a === 'n' || a === 'no') return { allow: false };
  return { allow: false, feedback: answer.trim().slice(0, width() * 4) };
}
