import { Command } from 'commander';
import { listHistoryEntries, getCurrentBranch } from '../lib/history.js';
import { verifySnapshot, verifyChain } from '../lib/signing.js';
import { listAuditEntries } from '../lib/auditStore.js';

export function registerExportCommand(program: Command) {
  const exportCmd = program.command('export').description('Export LaForge artifacts');

  exportCmd
    .command('provenance')
    .description('Export chain, signatures, approvals, and audit records')
    .option('--branch <branch>', 'Branch to export', '')
    .option('--limit <n>', 'Max audit entries', '')
    .action(async opts => {
      const baseDir = process.cwd();
      const branch = opts.branch || (await getCurrentBranch(baseDir));
      const entries = await listHistoryEntries(baseDir, { branch });
      const chain = await verifyChain(baseDir, branch);
      const snapshots = await Promise.all(
        entries.map(async e => ({
          ...e,
          verified: await verifySnapshot(e),
        })),
      );
      const audits = await listAuditEntries({}, { baseDir, limit: opts.limit ? Number(opts.limit) : 1000 });
      const payload = { branch, chain, snapshots, audits };
      console.log(JSON.stringify(payload, null, 2));
    });
}
