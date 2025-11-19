import path from 'node:path';
import { Command } from 'commander';
import { compileForSandbox } from '../../compiler/index.js';
import { readDomainFile, writeCompilationOutput } from './utils.js';
import { generateIncrementalMigration } from '../lib/persistence.js';
import { zipDirectories } from '../lib/zip.js';
import fs from 'node:fs/promises';

export function registerGenerateCommand(program: Command) {
  program
    .command('generate <domainFile>')
    .description('Generate SQL, services, routes, and migrations for a domain, and write an incremental migration')
    .option('-o, --out <dir>', 'output directory (defaults to <domain>/generated)')
    .option('--allow-destructive', 'allow destructive migrations (drops/type changes)', false)
    .option('--db <db>', 'target database (postgres|sqlite|mysql)', 'postgres')
    .option('--frontend-dir <dir>', 'path to generated frontend artifacts folder to include in the zip (optional)')
    .option('--no-zip', 'skip creating a zip archive of generated files', false)
    .action(async (domainFile: string, options: { out?: string; allowDestructive?: boolean; db?: string; zip?: boolean; frontendDir?: string }) => {
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

        if (options.zip !== false) {
          const zipTargets = [targetDir];

          const frontendDir =
            options.frontendDir || path.join(path.dirname(resolvedPath), 'generated_frontend');
          if (await pathExists(frontendDir)) {
            zipTargets.push(frontendDir);
          } else if (options.frontendDir) {
            console.warn(`\nNote: frontend path not found, skipping zip include: ${frontendDir}`);
          }

          try {
            const archivePath = await zipDirectories(zipTargets);
            console.log(`\nZip archive ready: ${archivePath}`);
          } catch (zipErr: any) {
            console.warn(`\nGenerated files, but failed to create zip: ${zipErr.message}`);
          }
        }
      } catch (error: any) {
        console.error('Generation failed:', error.message);
        process.exitCode = 1;
      }
    });
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
