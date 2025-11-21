import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type { CompilationOutput } from '../../compiler/index.js';
import { verifyProvenance } from '../lib/provenance.js';

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
  zod: '',
  domain: '',
  config: { db: 'sqlite', dialect: 'postgres-rds', domain: '', outDir: '', audit: false, multiTenant: true },
  queries: [],
  migrations: [],
};

function hashCompiled(obj: CompilationOutput) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

describe('cli provenance verification', () => {
  it('succeeds when compiled hash matches provenance', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-prov-cli-'));
    const compiledPath = path.join(baseDir, 'generated', 'compiled.json');
    const provPath = path.join(baseDir, '.laforge', 'provenance.json');
    await fs.mkdir(path.dirname(compiledPath), { recursive: true });
    await fs.mkdir(path.dirname(provPath), { recursive: true });
    await fs.writeFile(compiledPath, JSON.stringify(compiled, null, 2), 'utf8');
    await fs.writeFile(
      provPath,
      JSON.stringify({ compiledPath, compiledHash: hashCompiled(compiled) }, null, 2),
      'utf8',
    );

    const res = await verifyProvenance({ baseDir });
    expect(res.ok).toBe(true);
    expect(res.actualHash).toBe(hashCompiled(compiled));
  });

  it('fails when compiled hash does not match provenance', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-prov-cli-bad-'));
    const compiledPath = path.join(baseDir, 'generated', 'compiled.json');
    const provPath = path.join(baseDir, '.laforge', 'provenance.json');
    await fs.mkdir(path.dirname(compiledPath), { recursive: true });
    await fs.mkdir(path.dirname(provPath), { recursive: true });
    await fs.writeFile(compiledPath, JSON.stringify(compiled, null, 2), 'utf8');
    await fs.writeFile(provPath, JSON.stringify({ compiledPath, compiledHash: 'deadbeef' }, null, 2), 'utf8');

    const res = await verifyProvenance({ baseDir });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('Hash mismatch');
    expect(res.actualHash).toBe(hashCompiled(compiled));
    expect(res.expectedHash).toBe('deadbeef');
  });
});
