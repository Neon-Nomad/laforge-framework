import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { paths as laforgePaths } from './persistence.js';
import { historyPaths, listHistoryEntries, type ApprovalRecord, type HistoryEntry } from './history.js';
import { signHash, verifySignature } from './signing.js';
import { AuditLogger } from '../../runtime/audit.js';

function actorName(): string {
  return (
    process.env.LAFORGE_AUTHOR ||
    process.env.USER ||
    process.env.USERNAME ||
    (typeof process.getuid === 'function' ? String(process.getuid()) : undefined) ||
    'unknown'
  );
}

async function saveEntry(entry: HistoryEntry, baseDir: string): Promise<void> {
  const { historyDir } = historyPaths(baseDir);
  const entryPath = path.join(historyDir, entry.id, 'entry.json');
  await fs.writeFile(entryPath, JSON.stringify(entry, null, 2), 'utf8');
}

function approvalDigest(payload: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function readKeyPair(baseDir: string, privPath?: string, pubPath?: string) {
  const keyDir = path.join(laforgePaths(baseDir).root, 'keys');
  const priv = privPath || path.join(keyDir, 'ed25519_private.pem');
  const pub = pubPath || path.join(keyDir, 'ed25519_public.pem');
  const privateKey = crypto.createPrivateKey(await fs.readFile(priv, 'utf8'));
  let publicKey = crypto.createPublicKey(privateKey);
  try {
    const rawPub = await fs.readFile(pub, 'utf8');
    publicKey = crypto.createPublicKey(rawPub);
  } catch {
    // fall back to derived public key
  }
  return { privateKey, publicKey };
}

function auditLogger(baseDir: string): AuditLogger {
  const auditPath = path.join(laforgePaths(baseDir).root, 'audit', 'audit.ndjson');
  return new AuditLogger({ logFilePath: auditPath });
}

export function isApproved(entry?: HistoryEntry | null): boolean {
  if (!entry?.approvals?.length) return false;
  const latest = entry.approvals[entry.approvals.length - 1];
  return latest.decision === 'approved';
}

export async function recordApproval(
  entryId: string,
  decision: ApprovalRecord['decision'],
  options: { reason?: string; baseDir?: string; actor?: string; sign?: boolean; key?: string; pub?: string } = {},
): Promise<ApprovalRecord> {
  const baseDir = options.baseDir || process.cwd();
  const entries = await listHistoryEntries(baseDir, { all: true });
  const entry = entries.find(e => e.id === entryId);
  if (!entry) {
    throw new Error(`Snapshot not found: ${entryId}`);
  }

  const approval: ApprovalRecord = {
    id: uuidv4(),
    decision,
    actor: options.actor || actorName(),
    reason: options.reason,
    timestamp: new Date().toISOString(),
  };

  const approvalPayload = {
    entryId,
    decision,
    actor: approval.actor,
    reason: approval.reason || '',
    timestamp: approval.timestamp,
    entryHash: entry.hash || '',
  };
  approval.hash = approvalDigest(approvalPayload);

  if (options.sign) {
    const { privateKey, publicKey } = await readKeyPair(baseDir, options.key, options.pub);
    approval.signature = signHash(approval.hash, privateKey);
    approval.publicKey = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  }

  entry.approvals = [...(entry.approvals || []), approval];
  await saveEntry(entry, baseDir);

  auditLogger(baseDir).record('approval', {
    userId: approval.actor,
    artifactHash: entry.hash,
    data: { entryId, decision, reason: approval.reason },
  });

  return approval;
}

export function verifyApprovalSignature(approval: ApprovalRecord): boolean {
  if (!approval.signature || !approval.publicKey || !approval.hash) return false;
  return verifySignature(approval.hash, approval.signature, approval.publicKey);
}
