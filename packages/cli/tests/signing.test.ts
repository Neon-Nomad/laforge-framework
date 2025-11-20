import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { recordHistoryEntry, listHistoryEntries } from '../lib/history.js';
import { signSnapshot, verifySnapshot, verifyChain } from '../lib/signing.js';
import type { ModelDefinition } from '../../compiler/ast/types.js';

const model = (name: string): ModelDefinition => ({
  name,
  schema: { id: { type: 'uuid', primaryKey: true } },
  relations: [],
  policies: {},
  hooks: [],
  extensions: [],
});

async function writeKeypair(baseDir: string) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const root = path.join(baseDir, '.laforge', 'keys');
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'ed25519_private.pem'), privateKey.export({ format: 'pem', type: 'pkcs8' }), 'utf8');
  await fs.writeFile(path.join(root, 'ed25519_public.pem'), publicKey.export({ format: 'pem', type: 'spki' }), 'utf8');
}

describe('snapshot signing', () => {
  it('signs and verifies a snapshot and the chain', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-sign-'));
    await writeKeypair(baseDir);

    const entry = await recordHistoryEntry({ kind: 'snapshot', models: [model('Alpha')], baseDir, branch: 'main' });
    expect(entry.hash).toBeDefined();

    const signed = await signSnapshot(entry.id, { baseDir });
    expect(signed.signature).toBeDefined();
    expect(signed.publicKey).toBeDefined();

    const retrieved = (await listHistoryEntries(baseDir, { branch: 'main' }))[0];
    expect(await verifySnapshot(retrieved)).toBe(true);

    const chain = await verifyChain(baseDir, 'main');
    expect(chain.ok).toBe(true);
  });
});
