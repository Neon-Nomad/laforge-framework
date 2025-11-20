import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ModelDefinition } from '../../compiler/ast/types.js';
import {
  recordHistoryEntry,
  listHistoryEntries,
  cloneEntryToBranch,
} from '../lib/history.js';

const tempDirs: string[] = [];
let cwdBefore: string;

async function createWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-cherry-test-'));
  tempDirs.push(dir);
  return dir;
}

function model(name: string): ModelDefinition {
  return {
    name,
    schema: { id: { type: 'uuid', primaryKey: true }, title: { type: 'string' } },
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

describe('timeline cherry-pick', () => {
  it('clones a snapshot into another branch with preserved metadata', { timeout: 15000 }, async () => {
    const baseDir = await createWorkspace();
    process.chdir(baseDir);

    const source = await recordHistoryEntry({
      kind: 'snapshot',
      baseDir,
      branch: 'feature/a',
      models: [model('Article')],
      notes: 'feature snapshot',
      attachments: [
        {
          name: 'migration.sql',
          kind: 'migration',
          content: 'CREATE TABLE articles(id uuid primary key);',
        },
      ],
    });

    const cloned = await cloneEntryToBranch(source, 'main', { notePrefix: 'cherry-pick from feature' });
    expect(cloned.branch).toBe('main');
    expect(cloned.notes).toContain(source.id);

    const mainEntries = await listHistoryEntries(baseDir, { branch: 'main' });
    expect(mainEntries.some(e => e.id === cloned.id)).toBe(true);
    expect(cloned.attachments?.[0].name).toBe('migration.sql');
  });
});
