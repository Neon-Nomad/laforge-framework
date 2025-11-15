import { Command } from 'commander';
import pc from 'picocolors';
import { status as statusFn } from '../lib/persistence.js';

export function registerStatusCommand(program: Command) {
  program
    .command('status')
    .description('Show migration status')
    .action(async () => {
      try {
        const { applied, pending } = await statusFn();
        console.log(pc.cyan('Migration status:'));
        console.log(pc.green(`Applied: ${applied.length}`));
        console.log(pc.yellow(`Pending: ${pending.length}`));
        if (pending.length) {
          pending.forEach(m => console.log(` - ${m}`));
        }
      } catch (error: any) {
        console.error(pc.red(`Status failed: ${error.message}`));
        process.exitCode = 1;
      }
    });
}
