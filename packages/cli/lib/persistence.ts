import fs from 'node:fs/promises';
import path from 'node:path';
import { compileForSandbox } from '../../compiler/index.js';
import { computeSchemaDiff } from '../../compiler/diffing/schemaDiff.js';
import { generateMigrations } from '../../compiler/diffing/migrationGenerator.js';
import type { ModelDefinition } from '../../compiler/ast/types.js';
import { DatabaseConnection } from '../../runtime/db/database.js';
import { PostgresConnection } from '../../runtime/db/postgres.js';
import { MySQLConnection } from '../../runtime/db/mysql.js';

const LAFORGE_DIR = '.laforge';
const SCHEMA_FILE = 'schema.json';
const MIGRATIONS_DIR = 'migrations';
const STATE_FILE = 'state.json';

export interface Snapshot {
  version: number;
  savedAt: string;
  models: ModelDefinition[];
}

export interface MigrationState {
  applied: string[];
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export function paths(baseDir: string) {
  const root = path.resolve(baseDir, LAFORGE_DIR);
  return {
    root,
    schema: path.join(root, SCHEMA_FILE),
    migrationsDir: path.join(root, MIGRATIONS_DIR),
    state: path.join(root, MIGRATIONS_DIR, STATE_FILE),
  };
}

export async function loadSnapshot(baseDir = process.cwd()): Promise<ModelDefinition[]> {
  const p = paths(baseDir);
  try {
    const raw = await fs.readFile(p.schema, 'utf8');
    const snapshot = JSON.parse(raw) as Snapshot;
    return snapshot.models || [];
  } catch {
    return [];
  }
}

export async function saveSnapshot(models: ModelDefinition[], baseDir = process.cwd()): Promise<void> {
  const p = paths(baseDir);
  await ensureDir(p.root);
  const snapshot: Snapshot = { version: 1, savedAt: new Date().toISOString(), models };
  await fs.writeFile(p.schema, JSON.stringify(snapshot, null, 2), 'utf8');
}

export async function loadState(baseDir = process.cwd()): Promise<MigrationState> {
  const p = paths(baseDir);
  try {
    const raw = await fs.readFile(p.state, 'utf8');
    return JSON.parse(raw) as MigrationState;
  } catch {
    return { applied: [] };
  }
}

export async function saveState(state: MigrationState, baseDir = process.cwd()): Promise<void> {
  const p = paths(baseDir);
  await ensureDir(path.dirname(p.state));
  await fs.writeFile(p.state, JSON.stringify(state, null, 2), 'utf8');
}

function sanitizeSlug(slug: string): string {
  return slug.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'migration';
}

export function nextMigrationName(slug = 'migration'): string {
  const ts = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `${ts}_${sanitizeSlug(slug)}.sql`;
}

export async function listMigrations(baseDir = process.cwd()): Promise<string[]> {
  const p = paths(baseDir);
  try {
    const files = await fs.readdir(p.migrationsDir);
    return files.filter(f => f.endsWith('.sql')).sort();
  } catch {
    return [];
  }
}

export async function writeMigration(content: string, baseDir = process.cwd(), slug?: string): Promise<string> {
  const p = paths(baseDir);
  await ensureDir(p.migrationsDir);
  let name = nextMigrationName(slug);
  let target = path.join(p.migrationsDir, name);
  let counter = 1;
  while (true) {
    try {
      await fs.access(target);
      // file exists, tweak name
      name = name.replace(/\.sql$/, `_${counter}.sql`);
      target = path.join(p.migrationsDir, name);
      counter += 1;
    } catch {
      break;
    }
  }
  await fs.writeFile(target, content, 'utf8');
  return name;
}

export interface GenerateMigrationResult {
  migrationNames: string[];
  diffOperations: number;
}

export async function generateIncrementalMigration(options: {
  domainFile: string;
  allowDestructive?: boolean;
  out?: string;
  baseDir?: string;
  db?: 'postgres' | 'sqlite' | 'mysql';
}): Promise<GenerateMigrationResult> {
  const baseDir = options.baseDir || process.cwd();
  const targetDb = options.db || 'postgres';
  const domainPath = path.resolve(options.domainFile);
  const source = await fs.readFile(domainPath, 'utf8');
  const output = compileForSandbox(source);
  const latestModels = JSON.parse(JSON.stringify(output.models)) as ModelDefinition[];

  const previous = await loadSnapshot(baseDir);
  const diff = computeSchemaDiff(previous, latestModels, targetDb);
  const migrations = generateMigrations(latestModels, {
    previousModels: previous,
    db: targetDb,
    migrations: { allowDestructive: options.allowDestructive ?? false },
  });

  const migrationNames: string[] = [];
  if (migrations.length > 0 && diff.operations.length > 0) {
    for (const migration of migrations) {
      const name = await writeMigration(migration.content, baseDir);
      migrationNames.push(name);
    }
  }

  // save schema snapshot regardless so status reflects latest compile
  await saveSnapshot(latestModels, baseDir);

  return { migrationNames, diffOperations: diff.operations.length };
}

export interface ApplyOptions {
  baseDir?: string;
  dbPath?: string;
  to?: string;
  dryRun?: boolean;
  check?: boolean;
}

export async function applyMigrations(opts: ApplyOptions): Promise<{ applied: string[]; pending: string[] }> {
  const baseDir = opts.baseDir || process.cwd();
  const dbPath = opts.dbPath || path.resolve(baseDir, '.laforge', 'dev.db');
  const all = await listMigrations(baseDir);
  const state = await loadState(baseDir);

  let targetList = all.filter(m => !state.applied.includes(m));
  if (opts.to) {
    const idx = targetList.indexOf(opts.to);
    if (idx >= 0) targetList = targetList.slice(0, idx + 1);
  }

  if (opts.check && targetList.length > 0) {
    throw new Error(`Pending migrations: ${targetList.join(', ')}`);
  }

  if (opts.dryRun) {
    return { applied: [], pending: targetList };
  }

  if (targetList.length === 0) {
    return { applied: [], pending: [] };
  }

  const isPgUrl = /^postgres(ql)?:\/\//i.test(dbPath);
  const isMyUrl = /^mysql(\+.+)?:\/\//i.test(dbPath);
  const isUrl = isPgUrl || isMyUrl;
  if (!isUrl) {
    await ensureDir(path.dirname(dbPath));
  }
  const db = isPgUrl ? new PostgresConnection(dbPath) : isMyUrl ? new MySQLConnection(dbPath) : new DatabaseConnection(dbPath);
  for (const mig of targetList) {
    const content = await fs.readFile(path.join(paths(baseDir).migrationsDir, mig), 'utf8');
    await db.exec(content);
    state.applied.push(mig);
  }
  await saveState(state, baseDir);

  return { applied: targetList, pending: [] };
}

export async function status(baseDir = process.cwd()): Promise<{ applied: string[]; pending: string[] }> {
  const all = await listMigrations(baseDir);
  const state = await loadState(baseDir);
  const pending = all.filter(m => !state.applied.includes(m));
  return { applied: state.applied, pending };
}
