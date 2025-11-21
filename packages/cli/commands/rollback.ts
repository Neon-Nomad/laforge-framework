import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { getCurrentBranch, historyPaths, listHistoryEntries, resolveEntrySelector } from '../lib/history.js';
import { verifySnapshot } from '../lib/signing.js';

export function registerRollbackCommand(program: Command) {
  program
    .command('rollback')
    .description('Prepare a rollback bundle from a verified snapshot')
    .argument('<entry>', 'Entry selector (id or index)')
    .option('--branch <name>', 'Branch to select from (defaults to current)')
    .option('--out <dir>', 'Output directory for rollback bundle', '.laforge/rollback')
    .action(async (entrySel: string, opts: { branch?: string; out?: string }) => {
      const baseDir = process.cwd();
      const branch = opts.branch || (await getCurrentBranch(baseDir));
      const entries = await listHistoryEntries(baseDir, { branch });
      if (!entries.length) {
        console.error('No history entries found. Generate or migrate first.');
        process.exitCode = 1;
        return;
      }

      const target = resolveEntrySelector(entrySel, entries);
      if (!target) {
        console.error(`Could not resolve entry: ${entrySel}`);
        process.exitCode = 1;
        return;
      }

      const verified = target.signature ? await verifySnapshot(target) : Boolean(target.hash);
      if (!verified) {
        console.error(`Snapshot ${target.id} failed verification; aborting rollback bundle.`);
        process.exitCode = 1;
        return;
      }

      const { historyDir, root } = historyPaths(baseDir);
      const entryDir = path.join(historyDir, target.id);
      const outRoot = path.isAbsolute(opts.out || '') ? (opts.out as string) : path.join(baseDir, opts.out || '.laforge/rollback');
      const outDir = path.join(outRoot, target.id);
      await fs.mkdir(outRoot, { recursive: true });
      await fs.cp(entryDir, outDir, { recursive: true });

      console.log(
        JSON.stringify(
          {
            id: target.id,
            branch: target.branch,
            verified,
            bundle: outDir,
          },
          null,
          2,
        ),
      );
    });
}
