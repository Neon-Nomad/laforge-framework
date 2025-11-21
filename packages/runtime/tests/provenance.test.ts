import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { LaForgeRuntime } from '../index.js';
import { DatabaseConnection } from '../db/database.js';
import type { CompilationOutput } from '../../compiler/index.js';

const compiled: CompilationOutput = {
  models: [
    {
      name: 'User',
      schema: { id: 'uuid' },
      relations: [],
      policies: {},
      hooks: [],
      extensions: [],
    },
  ],
  sql: 'create table users(id uuid primary key);',
  zod: 'import * as zod from "zod";\nexport const UserSchema = zod.object({ id: zod.string() });',
  domain: 'module.exports = { userDomain: { create: async () => ({}) } };',
  config: { db: 'sqlite', dialect: 'postgres-rds', domain: '', outDir: '', audit: false, multiTenant: true },
  queries: [],
  migrations: [],
};

function hashCompiled(obj: CompilationOutput): string {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

describe('provenance verification', () => {
  it('refuses to load when hash mismatches', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-prov-'));
    const provPath = path.join(tmp, 'provenance.json');
    const db = new DatabaseConnection(':memory:');
    const runtime = new LaForgeRuntime(db);
    const compiledPath = path.join(tmp, 'compiled.json');
    await fs.writeFile(compiledPath, JSON.stringify(compiled, null, 2), 'utf8');
    await fs.writeFile(provPath, JSON.stringify({ compiledHash: 'deadbeef' }), 'utf8');
    process.env.PROVENANCE_PATH = provPath;
    await expect(runtime.loadCompiled(compiled)).rejects.toThrow(/Provenance hash mismatch/);
  });

  it('accepts matching hash', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-prov-'));
    const provPath = path.join(tmp, 'provenance.json');
    const db = new DatabaseConnection(':memory:');
    const runtime = new LaForgeRuntime(db);
    await fs.writeFile(provPath, JSON.stringify({ compiledHash: hashCompiled(compiled) }), 'utf8');
    process.env.PROVENANCE_PATH = provPath;
    const res = await runtime.loadCompiled(compiled);
    expect(res).toBe(compiled);
  });
});
