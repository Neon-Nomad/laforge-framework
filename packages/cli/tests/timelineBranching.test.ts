
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ModelDefinition } from '../../compiler/ast/types.js';
import {
  recordHistoryEntry,
  listHistoryEntries,
  getCurrentBranch,
  setCurrentBranch,
  listBranches,
} from '../lib/history.js';

const tempDirs: string[] = [];
let cwdBefore: string;

async function createWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-branch-test-'));
  tempDirs.push(dir);
  return dir;
}

function simpleModel(name = 'Post'): ModelDefinition {
  return {
    name,
    schema: { id: { type: 'uuid', primaryKey: true } },
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

describe('timeline branches', () => {
  it('records entries on the active branch and filters by branch', async () => {
    const baseDir = await createWorkspace();
    process.chdir(baseDir);

    // Default branch is main
    const mainEntry = await recordHistoryEntry({
      kind: 'snapshot',
      models: [simpleModel()],
      notes: 'main entry',
    });
    expect(mainEntry.branch).toBe('main');
    expect(await getCurrentBranch()).toBe('main');

    // Switch and record on feature branch
    await setCurrentBranch('feature/time-travel');
    const featureEntry = await recordHistoryEntry({
      kind: 'snapshot',
      models: [simpleModel('FeatureModel')],
      notes: 'feature entry',
    });
    expect(featureEntry.branch).toBe('feature/time-travel');

    // Default listing uses HEAD (feature)
    const featureList = await listHistoryEntries(baseDir);
    expect(featureList.every(e => e.branch === 'feature/time-travel')).toBe(true);

    const mainList = await listHistoryEntries(baseDir, { branch: 'main' });
    expect(mainList.length).toBe(1);
    expect(mainList[0].notes).toContain('main entry');

    const branches = await listBranches(baseDir);
    expect(branches).toEqual(['feature/time-travel', 'main']);
  });
});

