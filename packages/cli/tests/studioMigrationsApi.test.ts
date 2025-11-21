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

describe('/api/migrations', () => {
  it('lists migrations and can prepare rollback bundle', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-migrations-'));
    const entry = await recordHistoryEntry({
      kind: 'snapshot',
      models: [model('Alpha')],
      baseDir,
      migrationsCreated: ['001_init.sql'],
    });
    const server = await buildStudioServer({ baseDir, port: 0 });
    const res = await server.inject({ method: 'GET', url: '/api/migrations' });
    expect(res.statusCode).toBe(200);
    const json = res.json() as any;
    expect(Array.isArray(json.items)).toBe(true);
    expect(json.items[0].migrationsCreated[0]).toBe('001_init.sql');

    const roll = await server.inject({
      method: 'POST',
      url: '/api/migrations/rollback',
      payload: { id: entry.id },
    });
    expect(roll.statusCode).toBe(200);
    const body = roll.json() as any;
    expect(body.bundle).toContain(entry.id);
    const exists = await fs.access(body.bundle).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });
});
