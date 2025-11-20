import { describe, expect, it } from 'vitest';
import { recordHistoryEntry, listHistoryEntries } from '../lib/history.js';
import type { ModelDefinition } from '../../compiler/ast/types.js';

const model = (name: string): ModelDefinition => ({
  name,
  schema: {
    id: { type: 'uuid' as const, primaryKey: true },
  },
  relations: [],
  policies: {},
  hooks: [],
  extensions: [],
});

describe('history hashing', () => {
  it('chains hashes across snapshots', async () => {
    const baseDir = await (async () => {
      const { mkdtemp } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      return mkdtemp(join(tmpdir(), 'laforge-hash-'));
    })();

    const first = await recordHistoryEntry({ kind: 'snapshot', models: [model('Alpha')], baseDir, branch: 'main' });
    const second = await recordHistoryEntry({ kind: 'snapshot', models: [model('Beta')], baseDir, branch: 'main' });

    expect(first.hash).toBeDefined();
    expect(first.prevHash).toBeUndefined();
    expect(second.hash).toBeDefined();
    expect(second.prevHash).toBe(first.hash);

    const entries = await listHistoryEntries(baseDir, { branch: 'main' });
    const latest = entries[0];
    expect(latest.hash).toBe(second.hash);
  });
});
