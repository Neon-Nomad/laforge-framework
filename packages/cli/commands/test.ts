import { spawn } from 'node:child_process';
import { Command } from 'commander';

export function registerTestCommand(program: Command) {
  program
    .command('test')
    .description('Run the LaForge test suite')
    .action(async () => {
      const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const child = spawn(cmd, ['test'], { stdio: 'inherit' });

      const exitCode: number = await new Promise(resolve => {
        child.on('close', code => resolve(code ?? 1));
      });

      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    });
}
