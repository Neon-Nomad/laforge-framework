import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { buildStudioServer } from '../commands/studio.js';
import { recordHistoryEntry } from '../lib/history.js';
import type { ModelDefinition } from '../../compiler/ast/types.js';

const model = (name: string): ModelDefinition => ({
  name,
  schema: { id: { type: 'uuid', primaryKey: true } },
  relations: [],
  policies: {},
  hooks: [],
  extensions: [],
});

describe('/api/approvals', () => {
  it('lists history entries with approval status', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-approvals-'));
    await recordHistoryEntry({ kind: 'snapshot', models: [model('Alpha')], baseDir, branch: 'main' });

    const server = await buildStudioServer({ baseDir, port: 0 });
    const res = await server.inject({ method: 'GET', url: '/api/approvals' });
    expect(res.statusCode).toBe(200);
    const json = res.json() as any;
    expect(Array.isArray(json.items)).toBe(true);
    expect(json.items[0].approved).toBe(false);
  });
});
