import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ModelDefinition } from '../../compiler/ast/types.js';
import { listHistoryEntries } from '../lib/history.js';
import { saveSnapshot } from '../lib/persistence.js';

const { sandboxMock } = vi.hoisted(() => ({ sandboxMock: vi.fn() }));

vi.mock('@laforge-dev/auto-migrate', () => ({
  runMigrationInSandbox: sandboxMock,
}), { virtual: true });

import { autoMigrateNewMigrations } from '../commands/generate.js';

const tempDirs: string[] = [];

async function createWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-cli-test-'));
  tempDirs.push(dir);
  const migrationsDir = path.join(dir, '.laforge', 'migrations');
  await fs.mkdir(migrationsDir, { recursive: true });
  return dir;
}

afterEach(async () => {
  sandboxMock.mockReset();
  await Promise.all(tempDirs.map(dir => fs.rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe('auto-migrate integration inside CLI', () => {
  it('writes repaired SQL returned by the sandbox', async () => {
    const baseDir = await createWorkspace();
    const migrationName = '20250101_example.sql';
    const migrationPath = path.join(baseDir, '.laforge', 'migrations', migrationName);
    await fs.writeFile(migrationPath, 'CREATE TABLE posts(id uuid);');

    sandboxMock.mockResolvedValue({
      success: false,
      logs: ['boom'],
      repairedSql: 'CREATE TABLE posts(id uuid primary key);',
    });

    const summary = await autoMigrateNewMigrations({
      migrationNames: [migrationName],
      skip: false,
      baseDir,
    });

    const updated = await fs.readFile(migrationPath, 'utf8');
    expect(updated).toBe('CREATE TABLE posts(id uuid primary key);');
    expect(summary).toBe('Auto-migrate: repaired');
    expect(sandboxMock).toHaveBeenCalledTimes(1);
  });

  it('bypasses sandboxing when the skip flag is set', async () => {
    const baseDir = await createWorkspace();
    const migrationName = '20250102_skip.sql';

    const summary = await autoMigrateNewMigrations({
      migrationNames: [migrationName],
      skip: true,
      baseDir,
    });

    expect(summary).toBe('Auto-migrate: skipped by flag');
    expect(sandboxMock).not.toHaveBeenCalled();
  });

  it('records before/after timeline entries when repair succeeds (models provided)', async () => {
    const baseDir = await createWorkspace();
    const migrationName = '20250103_timeline.sql';
    const migrationPath = path.join(baseDir, '.laforge', 'migrations', migrationName);
    await fs.writeFile(migrationPath, 'CREATE TABLE posts(id uuid);');

    const models: ModelDefinition[] = [
      {
        name: 'Post',
        schema: { id: { type: 'uuid', primaryKey: true }, title: { type: 'string' } },
        relations: [],
        policies: {},
        hooks: [],
        extensions: [],
      },
    ];

    sandboxMock.mockResolvedValue({
      success: false,
      logs: ['boom'],
      repairedSql: 'CREATE TABLE posts(id uuid primary key, title text);',
    });

    const summary = await autoMigrateNewMigrations({
      migrationNames: [migrationName],
      skip: false,
      baseDir,
      modelsForHistory: models,
      domainContent: 'model Post { id: uuid pk }',
    });

    expect(summary).toBe('Auto-migrate: repaired');
    const entries = await listHistoryEntries(baseDir);
    const timelineMigs = entries.filter(e => e.notes?.includes(migrationName));
    expect(timelineMigs.length).toBe(2);
    expect(timelineMigs.some(e => e.notes?.includes('pre-fix'))).toBe(true);
    expect(timelineMigs.some(e => e.notes?.includes('post-fix'))).toBe(true);
    expect(timelineMigs.some(e => e.attachments?.[0]?.role === 'before')).toBe(true);
    expect(timelineMigs.some(e => e.attachments?.[0]?.role === 'after')).toBe(true);
  });

  it('falls back to saved snapshot when models are not provided', async () => {
    const baseDir = await createWorkspace();
    const migrationName = '20250104_snapshot.sql';
    const migrationPath = path.join(baseDir, '.laforge', 'migrations', migrationName);
    await fs.writeFile(migrationPath, 'CREATE TABLE teams(id uuid);');

    const models: ModelDefinition[] = [
      {
        name: 'Team',
        schema: { id: { type: 'uuid', primaryKey: true } },
        relations: [],
        policies: {},
        hooks: [],
        extensions: [],
      },
    ];
    await saveSnapshot(models, baseDir);

    sandboxMock.mockResolvedValue({
      success: false,
      logs: ['boom'],
      repairedSql: 'CREATE TABLE teams(id uuid primary key);',
    });

    const summary = await autoMigrateNewMigrations({
      migrationNames: [migrationName],
      skip: false,
      baseDir,
    });

    expect(summary).toBe('Auto-migrate: repaired');
    const entries = await listHistoryEntries(baseDir);
    expect(entries.some(e => e.notes?.includes('post-fix'))).toBe(true);
  });
});
