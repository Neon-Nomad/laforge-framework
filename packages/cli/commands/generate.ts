import path from 'node:path';
import { Command } from 'commander';
import { compileForSandbox } from '../../compiler/index.js';
import { readDomainFile, writeCompilationOutput } from './utils.js';
import { generateIncrementalMigration } from '../lib/persistence.js';

export function registerGenerateCommand(program: Command) {
  program
    .command('generate <domainFile>')
    .description('Generate SQL, services, routes, and migrations for a domain, and write an incremental migration')
    .option('-o, --out <dir>', 'output directory (defaults to <domain>/generated)')
    .option('--allow-destructive', 'allow destructive migrations (drops/type changes)', false)
    .option('--db <db>', 'target database (postgres|sqlite|mysql)', 'postgres')
    .action(async (domainFile: string, options: { out?: string; allowDestructive?: boolean; db?: string }) => {
      try {
        const { resolvedPath, content } = await readDomainFile(domainFile);
        const output = compileForSandbox(content);

        const targetDir =
          options.out || path.join(path.dirname(resolvedPath), 'generated');
        const files = await writeCompilationOutput(resolvedPath, output, targetDir);

        const migrationResult = await generateIncrementalMigration({
          domainFile: resolvedPath,
          allowDestructive: options.allowDestructive,
          db: (options.db as any) || 'postgres',
        });

        console.log(`Generated artifacts for ${output.models.length} models:`);
        files.forEach(f => console.log(`- ${f}`));
        if (migrationResult.migrationNames.length) {
          console.log('\nMigrations created:');
          migrationResult.migrationNames.forEach(name =>
            console.log(`- .laforge/migrations/${name}`)
          );
        } else {
          console.log('\nNo schema changes detected; no migration created.');
        }
      } catch (error: any) {
        console.error('Generation failed:', error.message);
        process.exitCode = 1;
      }
    });
}
