import { Command } from 'commander';
import { listHistoryEntries } from '../lib/history.js';
import { verifySnapshot, verifyChain } from '../lib/signing.js';
import { listAuditEntries } from '../lib/auditStore.js';
import crypto from 'node:crypto';
import { verifySbom } from '../lib/sbom.js';

export function registerVerifyCommand(program: Command) {
  const verify = program.command('verify').description('Verify signatures and chain integrity');

  verify
    .command('snapshot')
    .description('Verify a single snapshot by id')
    .argument('<id>', 'snapshot id')
    .action(async id => {
      const entry = (await listHistoryEntries(process.cwd(), { all: true })).find(e => e.id === id);
      if (!entry) {
        console.error(`Snapshot not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      const ok = await verifySnapshot(entry);
      console.log(JSON.stringify({ id: entry.id, verified: ok }, null, 2));
      if (!ok) process.exitCode = 1;
    });

  verify
    .command('chain')
    .description('Verify the hash chain and signatures for a branch')
    .option('--branch <branch>', 'Branch to verify')
    .action(async opts => {
      const res = await verifyChain(process.cwd(), opts.branch);
      console.log(JSON.stringify(res, null, 2));
      if (!res.ok) process.exitCode = 1;
    });

  verify
    .command('audit')
    .description('Compute an audit log digest for tamper detection')
    .option('--limit <n>', 'Limit entries considered', '2000')
    .action(async opts => {
      const entries = await listAuditEntries({}, { limit: Number(opts.limit) || 2000 });
      const sorted = entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      let prev = '';
      for (const entry of sorted) {
        const payload = JSON.stringify({ ...entry, prev });
        prev = crypto.createHash('sha256').update(payload).digest('hex');
      }
      const result = { count: sorted.length, digest: prev };
      console.log(JSON.stringify(result, null, 2));
    });

  verify
    .command('sbom')
    .description('Verify SBOM hashes and optional signature')
    .option('--require-signature', 'Fail if sbom.sig is missing', false)
    .action(async opts => {
      const res = await verifySbom({ requireSignature: Boolean(opts.requireSignature) });
      console.log(JSON.stringify(res, null, 2));
      if (!res.ok) process.exitCode = 1;
    });
}
