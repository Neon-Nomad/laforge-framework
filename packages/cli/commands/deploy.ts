import { Command } from 'commander';
import { getCurrentBranch, listHistoryEntries } from '../lib/history.js';
import { verifyChain } from '../lib/signing.js';
import { isApproved } from '../lib/approvals.js';

export function registerDeployCommand(program: Command) {
  program
    .command('deploy')
    .description('Deployment guard (verifies chain/approvals before real deploy)')
    .option('--branch <branch>', 'Branch to validate')
    .option('--require-signed', 'Require signed chain', false)
    .option('--require-approved', 'Require latest snapshot approval', false)
    .action(async opts => {
      const baseDir = process.cwd();
      const branch = opts.branch || (await getCurrentBranch(baseDir));
      if (opts.requireSigned) {
        const chain = await verifyChain(baseDir, branch);
        if (!chain.ok) {
          console.error('Chain verification failed', chain);
          process.exitCode = 1;
          return;
        }
      }

      if (opts.requireApproved) {
        const entries = await listHistoryEntries(baseDir, { branch });
        const latest = entries[0];
        if (!latest || !isApproved(latest)) {
          console.error('Latest snapshot is not approved.');
          process.exitCode = 1;
          return;
        }
      }

      console.log(
        JSON.stringify(
          {
            branch,
            chainChecked: !!opts.requireSigned,
            approvalsChecked: !!opts.requireApproved,
            ready: true,
          },
          null,
          2,
        ),
      );
    });
}
