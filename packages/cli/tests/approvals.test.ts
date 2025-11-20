import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { recordHistoryEntry, listHistoryEntries } from '../lib/history.js';
import { recordApproval, isApproved, verifyApprovalSignature } from '../lib/approvals.js';
import { listAuditEntries } from '../lib/auditStore.js';
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

describe('approvals', () => {
  it('records approvals and logs audit entries', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-approvals-'));
    const entry = await recordHistoryEntry({ kind: 'snapshot', models: [model('Alpha')], baseDir, branch: 'main' });
    expect(entry.id).toBeTruthy();

    const approval = await recordApproval(entry.id, 'approved', { reason: 'ship it', actor: 'qa', baseDir });
    expect(approval.decision).toBe('approved');

    const [latest] = await listHistoryEntries(baseDir, { branch: 'main' });
    expect(isApproved(latest)).toBe(true);
    expect(latest.approvals?.length).toBe(1);

    const audits = await listAuditEntries({}, { baseDir, limit: 10 });
    expect(audits.some(a => a.type === 'approval')).toBe(true);
  });

  it('supports signed approvals', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-approvals-sign-'));
    await writeKeypair(baseDir);
    const entry = await recordHistoryEntry({ kind: 'snapshot', models: [model('Beta')], baseDir, branch: 'main' });

    const approval = await recordApproval(entry.id, 'approved', { sign: true, baseDir });
    expect(approval.signature).toBeDefined();
    expect(approval.publicKey).toBeDefined();
    expect(approval.hash).toBeDefined();
    expect(verifyApprovalSignature(approval)).toBe(true);
  });
});
