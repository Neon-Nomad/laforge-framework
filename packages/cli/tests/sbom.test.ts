import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { signSbom, verifySbom } from '../lib/sbom.js';

async function writeKeypair(baseDir: string) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const keyDir = path.join(baseDir, '.laforge', 'keys');
  await fs.mkdir(keyDir, { recursive: true });
  await fs.writeFile(path.join(keyDir, 'ed25519_private.pem'), privateKey.export({ format: 'pem', type: 'pkcs8' }), 'utf8');
  await fs.writeFile(path.join(keyDir, 'ed25519_public.pem'), publicKey.export({ format: 'pem', type: 'spki' }), 'utf8');
}

async function writeSbomFixture(baseDir: string) {
  const lockPath = path.join(baseDir, 'package-lock.json');
  const lockData = {
    name: 'sbom-fixture',
    lockfileVersion: 3,
    packages: {
      '': { name: 'sbom-fixture', version: '1.0.0' },
      'node_modules/leftpad': { version: '1.0.0' },
    },
  };
  await fs.writeFile(lockPath, JSON.stringify(lockData, null, 2), 'utf8');
  const lockHash = crypto.createHash('sha256').update(JSON.stringify(lockData, null, 2)).digest('hex');
  const sbomDir = path.join(baseDir, '.laforge', 'sbom');
  await fs.mkdir(sbomDir, { recursive: true });
  const sbomPath = path.join(sbomDir, 'sbom.json');
  await fs.writeFile(
    sbomPath,
    JSON.stringify(
      { type: 'laforge-sbom', lockHash, packages: [{ name: '.', version: '1.0.0' }] },
      null,
      2,
    ),
    'utf8',
  );
  return { lockPath, lockHash, sbomPath };
}

describe('SBOM signing and verification', () => {
  it('verifies lock hash and signature when present', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-sbom-'));
    await writeKeypair(baseDir);
    await writeSbomFixture(baseDir);

    const initial = await verifySbom({ baseDir });
    expect(initial.ok).toBe(true);
    expect(initial.signatureChecked).toBe(false);

    await signSbom({ baseDir });
    const verified = await verifySbom({ baseDir, requireSignature: true });
    expect(verified.ok).toBe(true);
    expect(verified.signatureChecked).toBe(true);
  });

  it('fails when lock hash drifts', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-sbom-drift-'));
    await writeKeypair(baseDir);
    const { lockPath } = await writeSbomFixture(baseDir);
    await fs.writeFile(lockPath, 'drifted', 'utf8');

    const res = await verifySbom({ baseDir });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('lock hash mismatch');
  });
});
