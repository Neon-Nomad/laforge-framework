import { Command } from 'commander';
import { getCurrentBranch, listHistoryEntries } from '../lib/history.js';
import { verifyChain } from '../lib/signing.js';
import { isApproved } from '../lib/approvals.js';
import { verifyProvenance } from '../lib/provenance.js';
import { buildBlueGreenPlan } from '../lib/deploymentHardening.js';

export function registerDeployCommand(program: Command) {
  program
    .command('deploy')
    .description('Deployment guard (verifies chain/approvals or produces rollout plan)')
    .option('--branch <branch>', 'Branch to validate')
    .option('--strategy <strategy>', 'guard | bluegreen', 'guard')
    .option('--require-signed', 'Require signed chain', false)
    .option('--require-approved', 'Require latest snapshot approval', false)
    .option('--require-provenance', 'Require compiled.json hash matches provenance', false)
    .option('--traffic-steps <steps>', 'Comma separated traffic ramp percentages (blue/green plan)', (value: string) =>
      value
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !Number.isNaN(n)),
    )
    .option('--latency-budget <ms>', 'Latency budget in ms before auto-pause (blue/green plan)', (v: string) =>
      parseInt(v, 10),
    )
    .option('--error-budget <fraction>', 'Error budget threshold before auto-pause (blue/green plan)', (v: string) =>
      parseFloat(v),
    )
    .action(async opts => {
      if (opts.strategy === 'bluegreen') {
        const plan = buildBlueGreenPlan({
          trafficSteps: opts.trafficSteps && opts.trafficSteps.length ? opts.trafficSteps : undefined,
          latencyBudgetMs: typeof opts.latencyBudget === 'number' && !Number.isNaN(opts.latencyBudget) ? opts.latencyBudget : undefined,
          errorBudget: typeof opts.errorBudget === 'number' && !Number.isNaN(opts.errorBudget) ? opts.errorBudget : undefined,
        });
        console.log(JSON.stringify(plan, null, 2));
        return;
      }

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

      if (opts.requireProvenance) {
        const prov = await verifyProvenance({ baseDir });
        if (!prov.ok) {
          console.error('Provenance verification failed', prov);
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
            provenanceChecked: !!opts.requireProvenance,
            ready: true,
          },
          null,
          2,
        ),
      );
    });
}
