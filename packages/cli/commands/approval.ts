import { Command } from 'commander';
import { recordApproval, isApproved } from '../lib/approvals.js';
import { listHistoryEntries } from '../lib/history.js';
import { getCurrentBranch } from '../lib/history.js';

function registerDecisionCommand(
  program: Command,
  commandName: string,
  decision: 'approved' | 'rejected' | 'annotated',
  description: string,
) {
  program
    .command(commandName)
    .description(description)
    .argument('<id>', 'snapshot id')
    .option('--reason <text>', 'Reason or note')
    .option('--actor <actor>', 'Approver identity override')
    .option('--sign', 'Sign the approval decision')
    .option('--key <path>', 'Private key path for signing')
    .option('--pub <path>', 'Public key path for signing')
    .action(async (id, opts) => {
      try {
        const approval = await recordApproval(id, decision, {
          reason: opts.reason,
          actor: opts.actor,
          sign: !!opts.sign,
          key: opts.key,
          pub: opts.pub,
        });
        console.log(JSON.stringify({ id, approval }, null, 2));
      } catch (err: any) {
        console.error(err?.message || String(err));
        process.exitCode = 1;
      }
    });
}

export function registerApprovalCommands(program: Command) {
  registerDecisionCommand(program, 'approve', 'approved', 'Approve a snapshot by id');
  registerDecisionCommand(program, 'reject', 'rejected', 'Reject a snapshot by id');
  registerDecisionCommand(program, 'annotate', 'annotated', 'Annotate a snapshot without approval');

  program
    .command('approval-status')
    .description('Show approval status of the latest snapshot')
    .option('--branch <branch>', 'Branch name')
    .action(async opts => {
      const branch = opts.branch || (await getCurrentBranch(process.cwd()));
      const entries = await listHistoryEntries(process.cwd(), { branch });
      if (!entries.length) {
        console.error('No snapshots found');
        process.exitCode = 1;
        return;
      }
      const latest = entries[0];
      console.log(
        JSON.stringify(
          {
            entryId: latest.id,
            branch,
            approved: isApproved(latest),
            approvals: latest.approvals || [],
          },
          null,
          2,
        ),
      );
    });
}
