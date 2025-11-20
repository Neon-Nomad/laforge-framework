import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ModelDefinition } from '../../compiler/ast/types.js';
import {
  recordHistoryEntry,
  listHistoryEntries,
  resolveEntrySelector,
  diffHistoryEntries,
  loadEntryModels,
} from '../lib/history.js';

const tempDirs: string[] = [];
let cwdBefore: string;

function modelA(): ModelDefinition {
  return {
    name: 'Post',
    schema: {
      id: { type: 'uuid', primaryKey: true },
      title: { type: 'string' },
    },
    relations: [],
    policies: {},
    hooks: [],
    extensions: [],
  };
}

function modelB(): ModelDefinition {
  return {
    name: 'Post',
    schema: {
      id: { type: 'uuid', primaryKey: true },
      title: { type: 'string' },
      body: { type: 'text' },
    },
    relations: [],
    policies: {},
    hooks: [],
    extensions: [],
  };
}

async function createWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-history-test-'));
  tempDirs.push(dir);
  return dir;
}

beforeEach(async () => {
  cwdBefore = process.cwd();
});

afterEach(async () => {
  process.chdir(cwdBefore);
  await Promise.all(tempDirs.map(dir => fs.rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe('history snapshots and diffs', () => {
  it('records snapshots, supports selectors, and diffs attachments', async () => {
    const baseDir = await createWorkspace();
    process.chdir(baseDir);

    const first = await recordHistoryEntry({
      kind: 'snapshot',
      baseDir,
      models: [modelA()],
      domainContent: 'model Post { id: uuid pk, title: string }',
      migrationsCreated: ['2025_first.sql'],
      attachments: [
        {
          name: '2025_first.sql',
          kind: 'migration',
          role: 'before',
          content: 'CREATE TABLE posts(id uuid primary key, title text);',
        },
      ],
    });

    const second = await recordHistoryEntry({
      kind: 'snapshot',
      baseDir,
      models: [modelB()],
      domainContent: 'model Post { id: uuid pk, title: string, body: text }',
      migrationsCreated: ['2025_first.sql'],
      attachments: [
        {
          name: '2025_first.sql',
          kind: 'migration',
          role: 'after',
          content: 'CREATE TABLE posts(id uuid primary key, title text, body text);',
        },
      ],
    });

    const entries = await listHistoryEntries(baseDir);
    expect(entries.length).toBe(2);
    expect(entries[0].id).toBe(second.id); // newest first

    const latest = resolveEntrySelector('latest', entries);
    expect(latest?.id).toBe(second.id);

    const byIndex = resolveEntrySelector('1', entries);
    expect(byIndex?.id).toBe(first.id);

    const byPrefix = resolveEntrySelector(second.id.slice(0, 6), entries);
    expect(byPrefix?.id).toBe(second.id);

    const diff = await diffHistoryEntries(first, second, { baseDir, colors: false });
    expect(diff.diff.operations.length).toBeGreaterThan(0);
    expect(diff.attachmentDiffs.length).toBe(1);
    expect(diff.attachmentDiffs[0].change).toBe('modified');
    expect(diff.attachmentDiffs[0].patch).toContain('+CREATE TABLE posts(id uuid primary key, title text, body text);');

    const loadedModels = await loadEntryModels(first, baseDir);
    expect(loadedModels[0].schema.title).toBeDefined();
  });
});

