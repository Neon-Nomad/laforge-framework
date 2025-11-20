import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildStudioServer } from '../commands/studio.js';
import { recordHistoryEntry } from '../lib/history.js';
import type { ModelDefinition } from '../../compiler/ast/types.js';

const servers: any[] = [];
const tempDirs: string[] = [];
let cwdBefore: string;

function modelA(): ModelDefinition {
  return {
    name: 'Doc',
    schema: { id: { type: 'uuid', primaryKey: true } },
    relations: [],
    policies: {},
    hooks: [],
    extensions: [],
  };
}

function modelB(): ModelDefinition {
  return {
    name: 'Doc',
    schema: { id: { type: 'uuid', primaryKey: true }, title: { type: 'string' } },
    relations: [],
    policies: {},
    hooks: [],
    extensions: [],
  };
}

async function createWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-studio-test-'));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  cwdBefore = process.cwd();
});

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.close();
  }
  process.chdir(cwdBefore);
  await Promise.all(tempDirs.map(dir => fs.rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

afterAll(async () => {
  for (const server of servers) {
    await server.close();
  }
});

describe('Studio time-travel APIs', () => {
  it('handles branches, diff, cherry-pick, and replay', async () => {
    const baseDir = await createWorkspace();
    process.chdir(baseDir);

    const server = await buildStudioServer({ baseDir, port: 0 });
    servers.push(server);
    const inject = server.inject.bind(server);

    // initial branches
    let res = await inject({ method: 'GET', url: '/api/branches' });
    expect(res.statusCode).toBe(200);
    const branches = res.json() as any;
    expect(branches.current).toBe('main');

    // create feature branch
    res = await inject({
      method: 'POST',
      url: '/api/branches/create',
      payload: { name: 'feature/ui' },
    });
    expect(res.statusCode).toBe(200);

    // record snapshots directly for diff
    const entryA = await recordHistoryEntry({ kind: 'snapshot', models: [modelA()], baseDir, branch: 'main' });
    const entryB = await recordHistoryEntry({ kind: 'snapshot', models: [modelB()], baseDir, branch: 'main' });

    // timeline list
    res = await inject({ method: 'GET', url: '/api/timeline?branch=main' });
    expect(res.statusCode).toBe(200);
    const timeline = res.json() as any;
    expect(timeline.entries.length).toBeGreaterThanOrEqual(2);

    // diff
    res = await inject({
      method: 'GET',
      url: `/api/timeline/diff?from=${entryA.id}&to=${entryB.id}&fromBranch=main&toBranch=main`,
    });
    expect(res.statusCode).toBe(200);
    const diff = res.json() as any;
    expect(diff.diff?.operations?.length).toBeGreaterThan(0);

    // cherry-pick into feature branch
    res = await inject({
      method: 'POST',
      url: '/api/timeline/cherry-pick',
      payload: { entryId: entryB.id, targetBranch: 'feature/ui', notePrefix: 'cherry' },
    });
    expect(res.statusCode).toBe(200);
    const cherry = res.json() as any;
    expect(cherry.cloned.branch).toBe('feature/ui');

    // replay
    res = await inject({
      method: 'POST',
      url: '/api/timeline/replay',
      payload: { entryId: entryB.id, branch: 'main', db: 'sqlite' },
    });
    expect(res.statusCode).toBe(200);
    const replay = res.json() as any;
    expect(Array.isArray(replay.statements)).toBe(true);
    expect(replay.statements.length).toBeGreaterThan(0);

    // erd
    res = await inject({
      method: 'GET',
      url: `/api/timeline/erd?entryId=${entryB.id}&branch=main`,
    });
    expect(res.statusCode).toBe(200);
    const erd = res.json() as any;
    expect(erd.nodes.find((n: any) => n.name === 'Doc')).toBeTruthy();
    expect(Array.isArray(erd.edges)).toBe(true);
  }, 20000);
});
