import path from 'node:path';
import { Command } from 'commander';
import { compileForSandbox } from '../../compiler/index.js';
import { readDomainFile, writeCompilationOutput } from './utils.js';
import { generateIncrementalMigration } from '../lib/persistence.js';
import { zipDirectories } from '../lib/zip.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';

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
        const startedAt = Date.now();
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

        let archivePath: string | undefined;
        let archiveSizeKB: number | undefined;
        let frontendLines = 0;
        let frontendPathUsed: string | undefined;

        const zipTargets = [targetDir];

        const frontendDir =
          options.frontendDir || path.join(path.dirname(resolvedPath), 'generated_frontend/frontend');
        if (await pathExists(frontendDir)) {
          zipTargets.push(frontendDir);
          frontendPathUsed = frontendDir;
          frontendLines = await countLinesInDir(frontendDir);
        } else if (options.frontendDir) {
          console.warn(`\nNote: frontend path not found, skipping zip include: ${frontendDir}`);
        }

        if (options.zip !== false) {
          try {
            archivePath = await zipDirectories(zipTargets);
            const { size } = await fs.stat(archivePath);
            archiveSizeKB = Math.round(size / 1024);
          } catch (zipErr: any) {
            console.warn(`\nGenerated files, but failed to create zip: ${zipErr.message}`);
          }
        }

        await printSummary({
          domainPath: resolvedPath,
          targetDir,
          frontendDir: frontendPathUsed,
          output,
          durationMs: Date.now() - startedAt,
          archivePath,
          archiveSizeKB,
          frontendLines,
        });
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

async function countLinesInDir(dir: string): Promise<number> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await countLinesInDir(fullPath);
    } else {
      const content = await fs.readFile(fullPath, 'utf8');
      total += content.split(/\r?\n/).length;
    }
  }
  return total;
}

type SummaryInput = {
  domainPath: string;
  targetDir: string;
  frontendDir?: string;
  output: any;
  durationMs: number;
  archivePath?: string;
  archiveSizeKB?: number;
  frontendLines?: number;
};

async function printSummary(info: SummaryInput) {
  const {
    domainPath,
    targetDir,
    frontendDir,
    output,
    durationMs,
    archivePath,
    archiveSizeKB,
    frontendLines = 0,
  } = info;

  const line = chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const check = chalk.green('✓');
  const header = (label: string) => chalk.bold(label);

  const backendLines =
    sumLines(output?.sql) +
    sumLines(output?.rls) +
    sumLines(output?.zod) +
    sumLines(output?.domain) +
    sumLines(output?.routes) +
    sumLines(output?.services);
  const migrationsLines = (output?.migrations || []).reduce(
    (acc: number, m: any) => acc + sumLines(m?.content),
    0,
  );

  const totalBackendLines = backendLines + migrationsLines;
  const totalOutputLines = totalBackendLines + frontendLines;

  const modelsCount = Array.isArray(output?.models) ? output.models.length : 0;
  const policiesCount = Array.isArray(output?.policies) ? output.policies.length : 0;
  const hooksCount = Array.isArray(output?.hooks) ? output.hooks.length : 0;
  const extensionsCount = Array.isArray(output?.extensions) ? output.extensions.length : 0;

  const ratio = calcRatio(info.output?.ast || info.output, totalOutputLines);

  console.log();
  console.log(line);
  console.log(chalk.bold('✨ LaForge - Full-Stack Compiler'));
  console.log(line);

  console.log(`\n${header('📝 Analyzing')} ${path.basename(domainPath)}`);
  console.log(`   ${check} ${modelsCount} models${policiesCount ? `, ${policiesCount} policies` : ''}`);
  if (hooksCount || extensionsCount) {
    console.log(
      `   ${check} ${hooksCount} hooks${extensionsCount ? `, ${extensionsCount} extensions` : ''}`,
    );
  }

  console.log(`\n${header('🔨 Backend')}`);
  console.log(`   ${check} SQL / RLS / Zod / services / routes / migrations`);

  console.log(`\n${header('🎨 Frontend')}`);
  if (frontendDir) {
    console.log(`   ${check} Included from ${chalk.cyan(frontendDir)}`);
  } else {
    console.log(`   ${chalk.yellow('•')} No frontend bundle found`);
  }

  console.log(`\n${header('📦 Bundling')}`);
  console.log(`   ${check} Backend → ${chalk.cyan(targetDir)}`);
  if (frontendDir) {
    console.log(`   ${check} Frontend → ${chalk.cyan(frontendDir)}`);
  }
  if (archivePath) {
    console.log(`   ${check} Archive → ${chalk.cyan(archivePath)}${archiveSizeKB ? ` (${archiveSizeKB} KB)` : ''}`);
  }

  console.log(`\n${header('📊 Summary')}`);
  console.log(`   ${chalk.green('•')} Output lines: backend ${totalBackendLines}${frontendDir ? `, frontend ${frontendLines}` : ''}`);
  if (totalOutputLines) {
    console.log(`   ${chalk.green('•')} Total lines: ${totalOutputLines}${ratio ? ` (≈${ratio.toFixed(1)}x from input)` : ''}`);
  }
  console.log(`   ${chalk.green('•')} Time: ${(durationMs / 1000).toFixed(2)}s`);

  if (archivePath) {
    console.log(`\n${header('🚀 Next Steps')}`);
    console.log(`   unzip ${path.basename(archivePath)}`);
    console.log(`   cd backend && npm install && npm run migrate`);
    console.log(`   cd ../frontend && npm install && npm run dev`);
  }

  console.log(`\n${line}`);
  console.log(chalk.bold('✅ Generation complete!'));
  console.log(line);
}

function sumLines(content: string | undefined): number {
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

function calcRatio(inputAst: any, totalOutputLines: number): number | undefined {
  if (!inputAst || !totalOutputLines) return undefined;
  const text = typeof inputAst === 'string' ? inputAst : JSON.stringify(inputAst);
  const inputLines = text.split(/\r?\n/).length;
  if (!inputLines) return undefined;
  return totalOutputLines / inputLines;
}
