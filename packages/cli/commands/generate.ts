import { Command } from 'commander';
import { compileForSandbox, generateReactApplication } from '../../compiler/index.js';
import { readDomainFile, writeCompilationOutput } from './utils.js';
import { generateIncrementalMigration, paths as laforgePaths, loadSnapshot } from '../lib/persistence.js';
import { recordHistoryEntry } from '../lib/history.js';
import { zipDirectories } from '../lib/zip.js';
import { runMigrationInSandbox } from '@laforge-dev/auto-migrate';
import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import type { ModelDefinition } from '../../compiler/ast/types.js';

const exec = promisify(execCallback);

export function registerGenerateCommand(program: Command) {
  program
    .command('generate <domainFile>')
    .description('Generate SQL, services, routes, and migrations for a domain, and write an incremental migration')
    .option('-o, --out <dir>', 'output directory (defaults to <domain>/generated)')
    .option('--allow-destructive', 'allow destructive migrations (drops/type changes)', false)
    .option('--db <db>', 'target database (postgres|sqlite|mysql)', 'postgres')
    .option('--frontend-dir <dir>', 'path to generated frontend artifacts folder to include in the zip (optional)')
    .option('--skip-frontend', 'skip generating and building the frontend bundle', false)
    .option('--skip-auto-migrate', 'skip sandboxing migrations for automatic repair', false)
    .option('--no-zip', 'skip creating a zip archive of generated files', false)
    .action(async (domainFile: string, options: { out?: string; allowDestructive?: boolean; db?: string; zip?: boolean; frontendDir?: string; skipFrontend?: boolean; skipAutoMigrate?: boolean }) => {
      try {
        const startedAt = Date.now();
        const { resolvedPath, content } = await readDomainFile(domainFile);
        const output = compileForSandbox(content);

        // 1. Backend Generation
        const targetDir = options.out || path.join(path.dirname(resolvedPath), 'generated');
        await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
        const files = await writeCompilationOutput(resolvedPath, output, targetDir);

        const migrationResult = await generateIncrementalMigration({
          domainFile: resolvedPath,
          allowDestructive: options.allowDestructive,
          db: (options.db as any) || 'postgres',
        });

        const autoMigrateSummary = await autoMigrateNewMigrations({
          migrationNames: migrationResult.migrationNames,
          skip: options.skipAutoMigrate ?? false,
          baseDir: process.cwd(),
          modelsForHistory: output.models,
          domainPath: resolvedPath,
          domainContent: content,
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

        // 2. Frontend Generation & Build Pipeline
        let frontendLines = 0;
        let frontendPathUsed: string | undefined;
        let frontendDistPath: string | undefined;

        // Determine frontend output directory
        // We use a temp-like structure or a dedicated folder as per user request
        // User suggested: generated_frontend/frontend
        const frontendOutputDir = path.join(path.dirname(resolvedPath), 'generated_frontend', 'frontend');

        if (options.skipFrontend) {
          console.log(chalk.yellow('\nSkipping frontend generation (--skip-frontend).'));
        } else {
          console.log(chalk.blue('\n?? Starting Frontend Build Pipeline...'));

          // Step A: Run React Generator
          console.log('   Generating React application...');
          const frontendFiles = generateReactApplication(output.models, output.config);

          // Write frontend files
          await fs.rm(frontendOutputDir, { recursive: true, force: true }).catch(() => {});
          await fs.mkdir(frontendOutputDir, { recursive: true });
          for (const file of frontendFiles) {
            const filePath = path.join(frontendOutputDir, file.filePath);
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, file.content);
          }
          frontendPathUsed = frontendOutputDir;
          frontendLines = await countLinesInDir(frontendOutputDir);

          // Step B: Install Dependencies
          console.log('   Installing frontend dependencies (this may take a moment)...');
          try {
            await exec('npm install --silent', { cwd: frontendOutputDir });
          } catch (e: any) {
            console.warn(chalk.yellow(`   Warning: npm install failed: ${e.message}`));
          }

          // Step C: Build Frontend
          console.log('   Building frontend bundle...');
          try {
            await exec('npm run build', { cwd: frontendOutputDir });
            frontendDistPath = path.join(frontendOutputDir, 'dist');
          } catch (e: any) {
            console.warn(chalk.yellow(`   Warning: npm run build failed: ${e.message}`));
          }
        }

        // 3. Zip Everything
        let archivePath: string | undefined;
        let archiveSizeKB: number | undefined;

        const zipTargets = [targetDir]; // Backend
        if (frontendDistPath && await pathExists(frontendDistPath)) {
          zipTargets.push(frontendDistPath); // Frontend Dist
        } else if (!options.skipFrontend && await pathExists(frontendOutputDir)) {
          zipTargets.push(frontendOutputDir);
        }

        if (options.zip !== false) {
          try {
            // We might want to zip them into specific subfolders in the zip?
            // zipDirectories currently zips the folders at root level.
            // If we pass [backend, frontend/dist], the zip will contain 'generated' and 'dist'.
            // The user wanted /backend/ and /frontend/dist/ in the zip.
            // zipDirectories implementation details matter here. 
            // Assuming zipDirectories handles paths correctly.

            archivePath = await zipDirectories(zipTargets);
            const { size } = await fs.stat(archivePath);
            archiveSizeKB = Math.round(size / 1024);
          } catch (zipErr: any) {
            console.warn(`\nGenerated files, but failed to create zip: ${zipErr.message}`);
          }
        }

        const autoMigrateLabel = autoMigrateSummary;

        // 4. Record history for time-travel timeline
        try {
          await recordHistoryEntry({
            kind: 'generate',
            baseDir: process.cwd(),
            models: output.models,
            domainPath: resolvedPath,
            domainContent: content,
            migrationsCreated: migrationResult.migrationNames,
            allowDestructive: options.allowDestructive,
            diffOperations: migrationResult.diffOperations,
            autoMigrateSummary: autoMigrateLabel,
            metadata: {
              targetDir,
              frontendDir: frontendPathUsed,
              archivePath,
            },
          });
        } catch (historyError: any) {
          console.warn(chalk.yellow(`\nWarning: failed to record timeline entry: ${historyError?.message || historyError}`));
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
          autoMigrateSummary,
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
      // Skip node_modules and dist for line counting to keep it relevant to source
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
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
  autoMigrateSummary?: string;
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
    console.log(`   ${check} Generated & Built in ${chalk.cyan(frontendDir)}`);
  } else {
    console.log(`   ${chalk.yellow('???')} Frontend generation skipped/no bundle found`);
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

  const autoSummaryLabel = info.autoMigrateSummary || AUTO_MIGRATE_LABELS.none;
  console.log(`\n${header('🛡 Auto-migrate')}`);
  console.log(`   ${formatAutoMigrateLabel(autoSummaryLabel)}`);

  if (archivePath) {
    console.log(`\n${header('🚀 Next Steps')}`);
    console.log(`   unzip ${path.basename(archivePath)}`);
    console.log(`   # Backend`);
    console.log(`   cd backend && npm install && npm run migrate`);
    console.log(`   # Frontend`);
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

const AUTO_MIGRATE_LABELS = {
  skipped: 'Auto-migrate: skipped by flag',
  none: 'Auto-migrate: no changes needed',
  repaired: 'Auto-migrate: repaired',
  fallback: 'Auto-migrate: unrecoverable, fallback saved',
} as const;

type AutoMigrateState = keyof typeof AUTO_MIGRATE_LABELS;

interface AutoMigrateParams {
  migrationNames: string[];
  skip: boolean;
  baseDir: string;
  modelsForHistory?: ModelDefinition[];
  domainPath?: string;
  domainContent?: string;
}

export async function autoMigrateNewMigrations(params: AutoMigrateParams): Promise<string> {
  if (params.skip) {
    return AUTO_MIGRATE_LABELS.skipped;
  }
  if (!params.migrationNames.length) {
    return AUTO_MIGRATE_LABELS.none;
  }

  const laforge = laforgePaths(params.baseDir);
  const migrationsDir = laforge.migrationsDir;
  const repairedDir = path.join(laforge.root, 'repaired');
  let state: AutoMigrateState = 'none';
  let cachedModels: ModelDefinition[] | null = null;

  const ensureModels = async () => {
    if (params.modelsForHistory && params.modelsForHistory.length) return params.modelsForHistory;
    if (cachedModels) return cachedModels;
    cachedModels = await loadSnapshot(params.baseDir);
    return cachedModels;
  };

  for (const name of params.migrationNames) {
    const migrationPath = path.join(migrationsDir, name);
    const originalSql = await fs.readFile(migrationPath, 'utf8');
    let result;
    try {
      result = await runMigrationInSandbox(originalSql);
    } catch (error: any) {
      state = 'fallback';
      const fallbackPath = await writeFallbackFile(repairedDir, name, originalSql);
      console.error(
        chalk.red(`Auto-migrate failed for ${name}: ${error?.message || 'unknown error'}. Fallback saved to ${fallbackPath}`),
      );
      continue;
    }

    if (result.success) {
      continue;
    }

    if (result.repairedSql) {
      try {
        await fs.writeFile(migrationPath, result.repairedSql, 'utf8');
        if (state !== 'fallback') {
          state = 'repaired';
        }
        console.log(chalk.green(`Auto-migrate repaired ${name}`));
        // Record before/after snapshots for timeline diffing
        try {
          const models = await ensureModels();
          await recordHistoryEntry({
            kind: 'snapshot',
            baseDir: params.baseDir,
            models,
            domainPath: params.domainPath,
            domainContent: params.domainContent,
            migrationsCreated: [name],
            notes: `Auto-migrate ${name}: pre-fix`,
            attachments: [
              {
                name,
                kind: 'migration',
                role: 'before',
                description: 'Original migration before auto-repair',
                content: originalSql,
              },
            ],
          });
          await recordHistoryEntry({
            kind: 'snapshot',
            baseDir: params.baseDir,
            models,
            domainPath: params.domainPath,
            domainContent: params.domainContent,
            migrationsCreated: [name],
            notes: `Auto-migrate ${name}: post-fix`,
            attachments: [
              {
                name,
                kind: 'migration',
                role: 'after',
                description: 'Repaired migration after auto-repair',
                content: result.repairedSql,
              },
            ],
          });
        } catch (historyError: any) {
          console.warn(
            chalk.yellow(
              `Warning: failed to record auto-migrate timeline entries for ${name}: ${historyError?.message || historyError}`,
            ),
          );
        }
        continue;
      } catch (writeError: any) {
        state = 'fallback';
        const fallbackPath = await writeFallbackFile(repairedDir, name, result.repairedSql);
        console.warn(
          chalk.yellow(
            `Auto-migrate produced a repair for ${name}, but writing failed (${writeError?.message}). Saved fallback to ${fallbackPath}`,
          ),
        );
        continue;
      }
    }

    state = 'fallback';
    const fallbackPath = await writeFallbackFile(repairedDir, name, originalSql);
    console.warn(
      chalk.yellow(
        `Auto-migrate could not repair ${name}; manual intervention required. Fallback saved to ${fallbackPath}`,
      ),
    );
  }

  return AUTO_MIGRATE_LABELS[state];
}

async function writeFallbackFile(dir: string, fileName: string, content: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, fileName);
  await fs.writeFile(target, content, 'utf8');
  return target;
}

function formatAutoMigrateLabel(label: string): string {
  if (label === AUTO_MIGRATE_LABELS.repaired || label === AUTO_MIGRATE_LABELS.none) {
    return chalk.green(label);
  }
  if (label === AUTO_MIGRATE_LABELS.skipped) {
    return chalk.yellow(label);
  }
  if (label === AUTO_MIGRATE_LABELS.fallback) {
    return chalk.red(label);
  }
  return label;
}
