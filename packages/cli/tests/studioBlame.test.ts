import { describe, it, expect } from 'vitest';
import { buildStudioServer } from '../commands/studio.js';
import { recordHistoryEntry } from '../lib/history.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ModelDefinition } from '../../compiler/ast/types.js';

function model(name: string, withField?: string): ModelDefinition {
  const schema: any = { id: { type: 'uuid', primaryKey: true } };
  if (withField) schema[withField] = { type: 'string' };
  return { name, schema, relations: [], policies: {}, hooks: [], extensions: [] };
}

describe('Studio blame diff endpoint via UI flow', () => {
  it('returns operations usable for blame', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-blame-test-'));
    const server = await buildStudioServer({ baseDir, port: 0 });
    const inject = server.inject.bind(server);

    const entry1 = await recordHistoryEntry({ kind: 'snapshot', models: [model('Alpha')], baseDir });
    const entry2 = await recordHistoryEntry({ kind: 'snapshot', models: [model('Alpha', 'name')], baseDir });

    const res = await inject({
      method: 'GET',
      url: `/api/timeline/diff?from=${entry1.id}&to=${entry2.id}&json=true`,
    });
    expect(res.statusCode).toBe(200);
    const payload = res.json() as any;
    expect(payload.diff?.operations?.some((op: any) => op.kind === 'addColumn')).toBe(true);

    await server.close();
    await fs.rm(baseDir, { recursive: true, force: true });
  });
});

