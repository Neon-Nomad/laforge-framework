import fs from 'node:fs/promises';
import path from 'node:path';
import type { CompilationOutput } from '../../compiler/index.js';

export async function readDomainFile(domainFile: string): Promise<{ resolvedPath: string; content: string }> {
  const resolvedPath = path.resolve(domainFile);
  const content = await fs.readFile(resolvedPath, 'utf8');

  if (!content.trim()) {
    throw new Error(`Domain file "${resolvedPath}" is empty.`);
  }

  return { resolvedPath, content };
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function writeCompilationOutput(
  domainFile: string,
  output: CompilationOutput,
  outDir?: string,
): Promise<string[]> {
  const resolved = path.resolve(domainFile);
  const baseOut = outDir ? path.resolve(outDir) : path.join(path.dirname(resolved), 'generated');

  const sqlDir = path.join(baseOut, 'sql');
  const servicesDir = path.join(baseOut, 'services');
  const routesDir = path.join(baseOut, 'routes');
  const migrationsDir = path.join(baseOut, 'migrations');

  await Promise.all([ensureDir(sqlDir), ensureDir(servicesDir), ensureDir(routesDir), ensureDir(migrationsDir)]);

  const written: string[] = [];

  const schemaPath = path.join(sqlDir, 'schema.sql');
  await fs.writeFile(schemaPath, output.sql);
  written.push(schemaPath);

  const rlsPath = path.join(sqlDir, 'rls.sql');
  await fs.writeFile(rlsPath, output.rls);
  written.push(rlsPath);

  const zodPath = path.join(servicesDir, 'zod.ts');
  await fs.writeFile(zodPath, output.zod);
  written.push(zodPath);

  const domainPath = path.join(servicesDir, 'domain.ts');
  await fs.writeFile(domainPath, output.domain);
  written.push(domainPath);

  const routesPath = path.join(routesDir, 'routes.ts');
  await fs.writeFile(routesPath, output.routes);
  written.push(routesPath);

  for (const migration of output.migrations) {
    const targetPath = path.join(baseOut, migration.filePath);
    await ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, migration.content);
    written.push(targetPath);
  }

  return written;
}
