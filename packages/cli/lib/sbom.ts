import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths as laforgePaths } from './persistence.js';
import { readKeyPair } from './signing.js';

export interface SbomVerificationResult {
  ok: boolean;
  reason?: string;
  signatureChecked?: boolean;
  lockHash?: string;
  currentLockHash?: string;
}

function sbomPaths(baseDir: string) {
  const root = laforgePaths(baseDir).root;
  return {
    sbomPath: path.join(root, 'sbom', 'sbom.json'),
    sigPath: path.join(root, 'sbom', 'sbom.sig'),
    lockPath: path.join(baseDir, 'package-lock.json'),
  };
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function computeLockHash(lockPath: string): Promise<string> {
  const contents = await fs.readFile(lockPath);
  return crypto.createHash('sha256').update(contents).digest('hex');
}

export async function verifySbom(options: { baseDir?: string; requireSignature?: boolean } = {}): Promise<SbomVerificationResult> {
  const baseDir = options.baseDir || process.cwd();
  const { sbomPath, sigPath, lockPath } = sbomPaths(baseDir);
  if (!(await exists(sbomPath))) {
    return { ok: false, reason: 'SBOM missing' };
  }
  if (!(await exists(lockPath))) {
    return { ok: false, reason: 'package-lock.json missing' };
  }
  const parsed = JSON.parse(await fs.readFile(sbomPath, 'utf8'));
  if (!parsed.lockHash) {
    return { ok: false, reason: 'SBOM missing lockHash' };
  }
  const currentLockHash = await computeLockHash(lockPath);
  if (parsed.lockHash !== currentLockHash) {
    return { ok: false, reason: 'lock hash mismatch', lockHash: parsed.lockHash, currentLockHash };
  }

  const sigExists = await exists(sigPath);
  if (!sigExists && options.requireSignature) {
    return { ok: false, reason: 'signature missing', lockHash: parsed.lockHash, currentLockHash, signatureChecked: false };
  }

  if (sigExists) {
    const sigData = JSON.parse(await fs.readFile(sigPath, 'utf8'));
    if (!sigData.signature || !sigData.publicKey) {
      return { ok: false, reason: 'signature file missing fields', lockHash: parsed.lockHash, currentLockHash, signatureChecked: false };
    }
    const ok = crypto.verify(null, await fs.readFile(sbomPath), crypto.createPublicKey(sigData.publicKey), Buffer.from(sigData.signature, 'base64'));
    if (!ok) {
      return { ok: false, reason: 'signature invalid', lockHash: parsed.lockHash, currentLockHash, signatureChecked: true };
    }
    return { ok: true, lockHash: parsed.lockHash, currentLockHash, signatureChecked: true };
  }

  return { ok: true, lockHash: parsed.lockHash, currentLockHash, signatureChecked: false };
}

export async function signSbom(options: { baseDir?: string; key?: string; pub?: string } = {}) {
  const baseDir = options.baseDir || process.cwd();
  const { sbomPath, sigPath } = sbomPaths(baseDir);
  if (!(await exists(sbomPath))) {
    throw new Error('SBOM missing; run npm run sbom first');
  }
  const { privateKey, publicKey } = await readKeyPair(baseDir, options.key, options.pub);
  const data = await fs.readFile(sbomPath);
  const signature = crypto.sign(null, data, privateKey).toString('base64');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  await fs.mkdir(path.dirname(sigPath), { recursive: true });
  await fs.writeFile(sigPath, JSON.stringify({ signature, publicKey: publicKeyPem }, null, 2), 'utf8');
  return { signature, publicKey: publicKeyPem, sigPath, sbomPath };
}
