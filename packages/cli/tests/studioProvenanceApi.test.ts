import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { buildStudioServer } from '../commands/studio.js';
import type { CompilationOutput } from '../../compiler/index.js';

const compiled: CompilationOutput = {
  models: [{ name: 'User', schema: { id: 'uuid' }, relations: [], policies: {}, hooks: [], extensions: [] }],
  sql: '',
  zod: '',
  domain: '',
  config: { db: 'sqlite', dialect: 'postgres-rds', domain: '', outDir: '', audit: false, multiTenant: true },
  queries: [],
  migrations: [],
};

function hashCompiled(obj: CompilationOutput) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

describe('/api/provenance', () => {
  it('returns provenance verification details', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-studio-prov-'));
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

    const server = await buildStudioServer({ baseDir, port: 0 });
    const res = await server.inject({ method: 'GET', url: '/api/provenance' });
    expect(res.statusCode).toBe(200);
    const json = res.json() as any;
    expect(json.ok).toBe(true);
    expect(json.expectedHash).toBe(hashCompiled(compiled));
  });
});
