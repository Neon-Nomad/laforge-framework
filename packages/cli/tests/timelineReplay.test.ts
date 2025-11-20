import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ModelDefinition } from '../../compiler/ast/types.js';
import { recordHistoryEntry, listHistoryEntries } from '../lib/history.js';
import { registerTimelineCommand } from '../commands/timeline.js';
import { Command } from 'commander';
import { DatabaseConnection } from '../../runtime/db/database.js';

const tempDirs: string[] = [];
let cwdBefore: string;

async function createWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-replay-test-'));
  tempDirs.push(dir);
  return dir;
}

function sampleModel(): ModelDefinition {
  return {
    name: 'ReplayItem',
    schema: {
      id: { type: 'uuid', primaryKey: true },
      name: { type: 'string' },
    },
    relations: [],
    policies: {},
    hooks: [],
    extensions: [],
  };
}

beforeEach(() => {
  cwdBefore = process.cwd();
});

afterEach(async () => {
  process.chdir(cwdBefore);
  await Promise.all(tempDirs.map(dir => fs.rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe('timeline replay command', () => {
  it('restores a snapshot into a SQLite database and can warn on non-sqlite dialect', async () => {
    const baseDir = await createWorkspace();
    process.chdir(baseDir);

    const entry = await recordHistoryEntry({
      kind: 'snapshot',
      baseDir,
      models: [sampleModel()],
      domainContent: 'model ReplayItem { id: uuid pk, name: string }',
      notes: 'replay test',
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // First, succeed on sqlite dialect to ensure tables are created.
    const sqliteDbPath = path.join(baseDir, '.laforge', 'history', 'replay-sqlite.db');
    const programSqlite = new Command();
    registerTimelineCommand(programSqlite);
    await programSqlite.parseAsync([
      'node',
      'cli',
      'timeline',
      'replay',
      entry.id,
      '--db',
      'sqlite',
      '--db-path',
      sqliteDbPath,
    ]);

    const db = new DatabaseConnection(sqliteDbPath);
    const result = await db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='replay_items';",
    );
    expect(result.rows.length).toBe(1);
    db.close();

    // Second, cover non-sqlite warning path while stubbing exec to avoid SQL errors.
    const execSpy = vi.spyOn(DatabaseConnection.prototype, 'exec').mockImplementation(() => {});
    const programPg = new Command();
    registerTimelineCommand(programPg);
    await programPg.parseAsync([
      'node',
      'cli',
      'timeline',
      'replay',
      entry.id,
      '--db',
      'postgres',
      '--db-path',
      ':memory:',
    ]);

    expect(warnSpy).toHaveBeenCalled();
    expect(execSpy).toHaveBeenCalled();

    execSpy.mockRestore();
    warnSpy.mockRestore();
    logSpy.mockRestore();

    // sanity: the entry is discoverable via list
    const entries = await listHistoryEntries(baseDir);
    expect(entries.some(e => e.id === entry.id)).toBe(true);
  });
});
