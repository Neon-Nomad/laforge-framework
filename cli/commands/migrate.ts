import { Command } from 'commander';
import pc from 'picocolors';
import { applyMigrations } from '../lib/persistence.js';

export function registerMigrateCommand(program: Command) {
  program
    .command('migrate')
    .description('Apply pending migrations from .laforge/migrations')
    .option('--db <path>', 'SQLite database file to apply migrations to', '.laforge/dev.db')
    .option('--to <name>', 'Apply migrations up to and including this file name')
    .option('--dry-run', 'Show pending migrations without applying', false)
    .option('--check', 'CI mode: exit non-zero if there are pending migrations', false)
    .action(async (options: { db?: string; to?: string; dryRun?: boolean; check?: boolean }) => {
      try {
        const result = await applyMigrations({
          dbPath: options.db,
          to: options.to,
          dryRun: options.dryRun,
          check: options.check,
        });

        if (options.check && result.pending.length > 0) {
          console.error(pc.red(`Pending migrations: ${result.pending.join(', ')}`));
          process.exitCode = 1;
          return;
        }

        if (options.dryRun) {
          if (result.pending.length === 0) {
            console.log(pc.green('No pending migrations.'));
          } else {
            console.log(pc.yellow('Pending migrations (dry-run):'));
            result.pending.forEach(m => console.log(`- ${m}`));
          }
          return;
        }

        if (result.applied.length === 0) {
          console.log(pc.green('No pending migrations. Database is up to date.'));
        } else {
          console.log(pc.green('Applied migrations:'));
          result.applied.forEach(m => console.log(`- ${m}`));
        }
      } catch (error: any) {
        console.error(pc.red(`Migration failed: ${error.message}`));
        process.exitCode = 1;
      }
    });
}
