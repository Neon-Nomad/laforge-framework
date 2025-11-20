import { Command } from 'commander';
import pc from 'picocolors';
import {
  diffHistoryEntries,
  listHistoryEntries,
  listBranches,
  getCurrentBranch,
  setCurrentBranch,
  cloneEntryToBranch,
  resolveEntrySelector,
  loadEntryModels,
  type HistoryDiff,
} from '../lib/history.js';
import { generateMigrations } from '../../compiler/diffing/migrationGenerator.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseConnection } from '../../runtime/db/database.js';
import { paths as laforgePaths } from '../lib/persistence.js';

export function registerTimelineCommand(program: Command) {
  const cmd = program.command('timeline').description('Inspect time-travel snapshots recorded by LaForge');

  cmd
    .command('list')
    .description('List recorded timeline points (generate/migrate runs)')
    .option('--limit <n>', 'limit number of entries', toNumber)
    .option('--json', 'output as JSON', false)
    .option('--branch <name>', 'filter by branch (defaults to HEAD)')
    .option('--all', 'list entries from all branches', false)
    .action(async (options: { limit?: number; json?: boolean; branch?: string; all?: boolean }) => {
      const branch = options.all ? undefined : options.branch || (await getCurrentBranch());
      const entries = await listHistoryEntries(process.cwd(), { branch, all: options.all });
      const slice = typeof options.limit === 'number' ? entries.slice(0, options.limit) : entries;

      if (options.json) {
        console.log(
          JSON.stringify(
            { branch: branch || 'all', entries: slice },
            null,
            2,
          ),
        );
        return;
      }

      if (!slice.length) {
        console.log(pc.yellow('No timeline entries found. Generate or migrate to create a snapshot.'));
        return;
      }

      const branchLabel = branch ? ` (branch: ${branch})` : ' (all branches)';
      console.log(pc.bold(`Timeline (newest first)${branchLabel}:`));
      slice.forEach((entry, idx) => {
        console.log(
          [
            `#${idx}`,
            entry.createdAt,
            entry.kind,
            entry.id,
            `branch: ${entry.branch || 'main'}`,
            entry.migrationsCreated?.length ? `migrations: ${entry.migrationsCreated.length}` : '',
            entry.migrationsApplied?.length ? `applied: ${entry.migrationsApplied.length}` : '',
          ]
            .filter(Boolean)
            .join(' | '),
        );
      });
    });

  cmd
    .command('diff <from> <to>')
    .description('Show schema diff between two timeline points')
    .option('--db <db>', 'target database (postgres|sqlite|mysql)', 'postgres')
    .option('--json', 'output as JSON', false)
    .option('--no-colors', 'disable colorized output')
    .option('--from-branch <name>', 'branch for the "from" selector (defaults to HEAD)')
    .option('--to-branch <name>', 'branch for the "to" selector (defaults to HEAD)')
    .action(async (fromSel: string, toSel: string, options: { db?: string; json?: boolean; colors?: boolean; fromBranch?: string; toBranch?: string }) => {
      const fromBranch = options.fromBranch || (await getCurrentBranch());
      const toBranch = options.toBranch || fromBranch;
      const fromEntries = await listHistoryEntries(process.cwd(), { branch: fromBranch });
      const toEntries = toBranch === fromBranch ? fromEntries : await listHistoryEntries(process.cwd(), { branch: toBranch });
      const entries = toBranch === fromBranch ? fromEntries : [...fromEntries, ...toEntries];
      if (!entries.length) {
        console.error(pc.red('No timeline entries found.'));
        process.exitCode = 1;
        return;
      }

      const from = resolveEntrySelector(fromSel, fromEntries);
      const to = resolveEntrySelector(toSel, toEntries);
      if (!from) {
        console.error(pc.red(`Could not find 'from' entry: ${fromSel}`));
        process.exitCode = 1;
        return;
      }
      if (!to) {
        console.error(pc.red(`Could not find 'to' entry: ${toSel}`));
        process.exitCode = 1;
        return;
      }

      const diff: HistoryDiff = await diffHistoryEntries(from, to, {
        db: (options.db as any) || 'postgres',
        colors: options.colors !== false,
      });

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              from: diff.from,
              to: diff.to,
              diff: diff.diff,
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log(pc.bold(`Schema diff: ${from.id} (${from.branch}) -> ${to.id} (${to.branch})`));
      console.log(diff.formatted || 'No schema changes detected.');
      if (diff.diff.warnings.length) {
        console.log(pc.yellow('\nWarnings:'));
        diff.diff.warnings.forEach(w => console.log(`- ${w}`));
      }

      if (diff.attachmentDiffs.length) {
        console.log(pc.bold('\nAttachment diffs (migrations/policies/etc):'));
        diff.attachmentDiffs.forEach(att => {
          const label = [att.change.toUpperCase(), att.name, att.kind ? `(${att.kind})` : '']
            .filter(Boolean)
            .join(' ');
          console.log(label);
          if (att.roleFrom || att.roleTo) {
            console.log(`  roles: ${att.roleFrom ?? '-'} -> ${att.roleTo ?? '-'}`);
          }
          if (att.patch) {
            const snippet = att.patch.split('\n').slice(0, 50).join('\n');
            console.log(snippet);
            if (att.patch.split('\n').length > 50) {
              console.log('  ...');
            }
          }
        });
      }
    });

  cmd
    .command('replay <entry>')
    .description('Restore a snapshot into a sandbox SQLite database')
    .option('--db <db>', 'target database dialect for schema rendering (postgres|sqlite|mysql)', 'sqlite')
    .option('--db-path <path>', 'SQLite file path (use :memory: for in-memory)', '.laforge/history/replay.db')
    .option('--branch <name>', 'branch to resolve the entry from (defaults to HEAD)')
    .action(async (entrySel: string, options: { db?: string; dbPath?: string; branch?: string }) => {
      const branch = options.branch || (await getCurrentBranch());
      const entries = await listHistoryEntries(process.cwd(), { branch });
      const target = resolveEntrySelector(entrySel, entries);
      if (!target) {
        console.error(pc.red(`Snapshot not found in branch ${branch}: ${entrySel}`));
        process.exitCode = 1;
        return;
      }

      const dbKind = (options.db as any) || 'sqlite';
      if (dbKind !== 'sqlite') {
        console.warn(pc.yellow(`Replay currently uses SQLite. Rendering schema for ${dbKind}, but execution uses SQLite.`));
      }

      const dbPath = options.dbPath || path.join(laforgePaths(process.cwd()).root, 'history', 'replay.db');
      const useMemory = dbPath === ':memory:';
      if (!useMemory) {
        await fs.mkdir(path.dirname(dbPath), { recursive: true });
        await fs.rm(dbPath, { force: true });
      }

      const models = await loadEntryModels(target);
      const migrations = generateMigrations(models, { previousModels: [], db: dbKind as any });
      if (!migrations.length) {
        console.log(pc.yellow('No schema statements generated for this snapshot.'));
        return;
      }

      const db = new DatabaseConnection(useMemory ? ':memory:' : dbPath);
      try {
        for (const mig of migrations) {
          db.exec(mig.content);
        }
        console.log(pc.green(`Snapshot restored to ${useMemory ? ':memory:' : dbPath}`));
      } catch (error: any) {
        console.error(pc.red(`Replay failed: ${error?.message || error}`));
        process.exitCode = 1;
      } finally {
        db.close();
      }
    });

  const branchCmd = cmd.command('branch').description('Manage timeline branches');

  branchCmd
    .command('list')
    .description('List branches (current marked with *)')
    .option('--json', 'output as JSON', false)
    .action(async (options: { json?: boolean }) => {
      const [branches, current] = await Promise.all([listBranches(), getCurrentBranch()]);
      if (options.json) {
        console.log(JSON.stringify({ current, branches }, null, 2));
        return;
      }
      branches.forEach(b => {
        const mark = b === current ? '*' : ' ';
        console.log(`${mark} ${b}`);
      });
    });

  branchCmd
    .command('create <name>')
    .description('Create a new branch and switch HEAD to it')
    .action(async (name: string) => {
      await setCurrentBranch(name);
      console.log(pc.green(`Switched to new branch '${name}'`));
    });

  branchCmd
    .command('switch <name>')
    .description('Switch HEAD to an existing branch')
    .action(async (name: string) => {
      await setCurrentBranch(name);
      console.log(pc.green(`Switched to branch '${name}'`));
    });

  cmd
    .command('cherry-pick <entry>')
    .description('Copy a snapshot into another branch')
    .option('--to-branch <name>', 'target branch (defaults to HEAD)')
    .option('--note-prefix <text>', 'optional note prefix on the new snapshot')
    .action(async (entrySel: string, options: { toBranch?: string; notePrefix?: string }) => {
      const targetBranch = options.toBranch || (await getCurrentBranch());
      const entries = await listHistoryEntries(process.cwd(), { all: true });
      const source = resolveEntrySelector(entrySel, entries);
      if (!source) {
        console.error(pc.red(`Snapshot not found: ${entrySel}`));
        process.exitCode = 1;
        return;
      }
      try {
        const cloned = await cloneEntryToBranch(source, targetBranch, {
          notePrefix: options.notePrefix || `cherry-pick from`,
        });
        console.log(pc.green(`Cherry-picked ${source.id} into ${targetBranch} as ${cloned.id}`));
      } catch (error: any) {
        console.error(pc.red(`Cherry-pick failed: ${error?.message || error}`));
        process.exitCode = 1;
      }
    });

  cmd
    .command('merge <sourceBranch>')
    .description('Merge the latest snapshot from a source branch into the current (or target) branch by copying it')
    .option('--into <branch>', 'target branch (defaults to HEAD)')
    .option('--note-prefix <text>', 'optional note prefix on the merged snapshot')
    .action(async (sourceBranch: string, options: { into?: string; notePrefix?: string }) => {
      const targetBranch = options.into || (await getCurrentBranch());
      const sourceEntries = await listHistoryEntries(process.cwd(), { branch: sourceBranch });
      if (!sourceEntries.length) {
        console.error(pc.red(`No snapshots found on branch ${sourceBranch}`));
        process.exitCode = 1;
        return;
      }
      const latest = sourceEntries[0];
      try {
        const merged = await cloneEntryToBranch(latest, targetBranch, {
          notePrefix: options.notePrefix || `merge from ${sourceBranch}`,
        });
        console.log(pc.green(`Merged latest (${latest.id}) from ${sourceBranch} into ${targetBranch} as ${merged.id}`));
      } catch (error: any) {
        console.error(pc.red(`Merge failed: ${error?.message || error}`));
        process.exitCode = 1;
      }
    });
}

function toNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
