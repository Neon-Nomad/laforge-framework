import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseConnection } from '../../runtime/db/database.js';
import { detectDrift } from '../../runtime/drift.js';
import type { CompilationOutput } from '../../compiler/index.js';

const compiled: CompilationOutput = {
  models: [
    {
      name: 'User',
      schema: {
        id: 'uuid',
        email: 'string',
      },
      relations: [],
      policies: {},
      hooks: [],
      extensions: [],
    },
  ],
  ast: '',
  sql: '',
  zod: '',
  domain: '',
  rls: '',
  routes: '',
  config: { db: 'sqlite', dialect: 'postgres-rds', domain: [], outDir: 'generated', audit: false, multiTenant: true },
  migrations: [],
};

describe('drift detector', () => {
  it('flags missing and extra columns', async () => {
    const dbPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-drift-')), 'db.sqlite');
    const db = new DatabaseConnection(dbPath);
    await db.exec('CREATE TABLE users(id TEXT PRIMARY KEY);');

    const drift = await detectDrift(db, compiled);
    expect(drift.length).toBe(1);
    expect(drift[0].missingColumns).toContain('email');
  });
});
