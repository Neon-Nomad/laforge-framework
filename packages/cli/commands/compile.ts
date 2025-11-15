import { Command } from 'commander';
import { compileForSandbox } from '../../compiler/index.js';
import { readDomainFile, writeCompilationOutput } from './utils.js';

export function registerCompileCommand(program: Command) {
  program
    .command('compile <domainFile>')
    .description('Compile a domain file and optionally emit generated artifacts')
    .option('-o, --out <dir>', 'output directory for generated assets')
    .action(async (domainFile: string, options: { out?: string }) => {
      try {
        const { resolvedPath, content } = await readDomainFile(domainFile);
        const output = compileForSandbox(content);

        console.log(`Compiled ${output.models.length} models from ${resolvedPath}`);
        output.models.forEach(model => {
          console.log(`- ${model.name}: fields=${Object.keys(model.schema).length} policies=${Object.keys(model.policies).length}`);
        });

        if (options.out) {
          const files = await writeCompilationOutput(resolvedPath, output, options.out);
          console.log('\nArtifacts written:');
          files.forEach(f => console.log(`  - ${f}`));
        } else {
          console.log('\nNo output directory provided; skipping file generation.');
        }
      } catch (error: any) {
        console.error('Compilation failed:', error.message);
        process.exitCode = 1;
      }
    });
}
