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

describe('/api/policy-impact', () => {
  it('returns policy attachment line deltas', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-policy-impact-'));
    const entryA = await recordHistoryEntry({
      kind: 'snapshot',
      models: [model('Alpha')],
      baseDir,
      attachments: [{ name: 'policies.sql', kind: 'policy', content: 'ALLOW alpha\n' }],
    });
    const entryB = await recordHistoryEntry({
      kind: 'snapshot',
      models: [model('Alpha')],
      baseDir,
      attachments: [{ name: 'policies.sql', kind: 'policy', content: 'ALLOW alpha\nDENY beta\n' }],
    });

    const server = await buildStudioServer({ baseDir, port: 0 });
    const res = await server.inject({
      method: 'GET',
      url: `/api/policy-impact?from=${entryA.id}&to=${entryB.id}`,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as any;
    expect(json.added).toBeGreaterThan(0);
    expect(json.modified).toBe(1);
    expect(json.attachments[0].patchSnippet).toContain('DENY');
  });
});
