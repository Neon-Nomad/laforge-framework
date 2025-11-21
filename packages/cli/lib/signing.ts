import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths as laforgePaths } from './persistence.js';
import { historyPaths } from './history.js';
import type { HistoryEntry } from './history.js';
import { listHistoryEntries } from './history.js';

interface KeyPair {
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
}

export function defaultKeyPaths(baseDir: string) {
  const root = laforgePaths(baseDir).root;
  return {
    priv: path.join(root, 'keys', 'ed25519_private.pem'),
    pub: path.join(root, 'keys', 'ed25519_public.pem'),
  };
}

export async function readKeyPair(baseDir: string, privPath?: string, pubPath?: string): Promise<KeyPair> {
  const paths = defaultKeyPaths(baseDir);
  const privateKeyPem = await fs.readFile(privPath || paths.priv, 'utf8');
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  let publicKey: crypto.KeyObject;
  if (pubPath || (await exists(paths.pub))) {
    const publicKeyPem = await fs.readFile(pubPath || paths.pub, 'utf8');
    publicKey = crypto.createPublicKey(publicKeyPem);
  } else {
    publicKey = crypto.createPublicKey(privateKey);
  }
  return { privateKey, publicKey };
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export function signHash(hash: string, privateKey: crypto.KeyObject): string {
  const signature = crypto.sign(null, Buffer.from(hash, 'hex'), privateKey);
  return signature.toString('base64');
}

export function verifySignature(hash: string, signature: string, publicKey: crypto.KeyObject | string): boolean {
  try {
    const keyObj = typeof publicKey === 'string' ? crypto.createPublicKey(publicKey) : publicKey;
    return crypto.verify(null, Buffer.from(hash, 'hex'), keyObj, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

async function saveEntry(entry: HistoryEntry, baseDir: string): Promise<void> {
  const { historyDir } = historyPaths(baseDir);
  const entryPath = path.join(historyDir, entry.id, 'entry.json');
  await fs.writeFile(entryPath, JSON.stringify(entry, null, 2), 'utf8');
}

export async function signSnapshot(entryId: string, options: { baseDir?: string; key?: string; pub?: string } = {}) {
  const baseDir = options.baseDir || process.cwd();
  const entries = await listHistoryEntries(baseDir, { all: true });
  const entry = entries.find(e => e.id === entryId);
  if (!entry) {
    throw new Error(`Snapshot not found: ${entryId}`);
  }
  if (!entry.hash) {
    throw new Error('Entry missing hash; cannot sign');
  }
  const { privateKey, publicKey } = await readKeyPair(baseDir, options.key, options.pub);
  entry.signature = signHash(entry.hash, privateKey);
  entry.publicKey = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  await saveEntry(entry, baseDir);
  return entry;
}

export async function verifySnapshot(entry: HistoryEntry): Promise<boolean> {
  if (!entry.signature || !entry.publicKey || !entry.hash) return false;
  return verifySignature(entry.hash, entry.signature, entry.publicKey);
}

export async function verifyChain(baseDir = process.cwd(), branch?: string): Promise<{
  ok: boolean;
  brokenAt?: string;
  unsigned?: string[];
}> {
  const entries = await listHistoryEntries(baseDir, { branch: branch || (await (await import('./history.js')).getCurrentBranch(baseDir)) });
  const unsigned: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.prevHash && entry.prevHash !== entries[i + 1]?.hash) {
      return { ok: false, brokenAt: entry.id, unsigned };
    }
    if (!entry.signature || !entry.publicKey || !(await verifySnapshot(entry))) {
      unsigned.push(entry.id);
    }
  }
  return { ok: unsigned.length === 0, unsigned };
}
