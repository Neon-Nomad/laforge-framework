import path from 'node:path';
import { Command } from 'commander';
import { compileForSandbox } from '../../compiler/index.js';
import { readDomainFile, writeCompilationOutput } from './utils.js';

export function registerGenerateCommand(program: Command) {
  program
    .command('generate <domainFile>')
    .description('Generate SQL, services, routes, and migrations for a domain')
    .option('-o, --out <dir>', 'output directory (defaults to <domain>/generated)')
    .action(async (domainFile: string, options: { out?: string }) => {
      try {
        const { resolvedPath, content } = await readDomainFile(domainFile);
        const output = compileForSandbox(content);

        const targetDir =
          options.out || path.join(path.dirname(resolvedPath), 'generated');
        const files = await writeCompilationOutput(resolvedPath, output, targetDir);

        console.log(`Generated artifacts for ${output.models.length} models:`);
        files.forEach(f => console.log(`- ${f}`));
      } catch (error: any) {
        console.error('Generation failed:', error.message);
        process.exitCode = 1;
      }
    });
}
