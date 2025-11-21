import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { buildStudioServer } from '../commands/studio.js';

describe('/api/drift', () => {
  it('returns unavailable when compiled.json is missing', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-drift-api-'));
    const server = await buildStudioServer({ baseDir, port: 0 });
    const res = await server.inject({ method: 'GET', url: '/api/drift' });
    expect(res.statusCode).toBe(200);
    const json = res.json() as any;
    expect(json.enabled).toBe(false);
    expect(json.reason).toBe('compiled.json not found');
  });
});
