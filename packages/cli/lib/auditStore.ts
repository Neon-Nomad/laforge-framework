import fs from 'node:fs/promises';
import path from 'node:path';
import { paths as laforgePaths } from './persistence.js';
import { DatabaseConnection } from '../../runtime/db/database.js';

export interface AuditEntry {
  id: string;
  timestamp: string;
  type: string;
  userId?: string;
  tenantId?: string;
  requestId?: string;
  model?: string;
  artifactHash?: string;
  data?: unknown;
}

export interface AuditFilters {
  tenant?: string;
  model?: string;
  action?: string;
  user?: string;
  type?: string;
  since?: string;
}

const AUDIT_DIR = 'audit';
const AUDIT_FILE = 'audit.ndjson';
const AUDIT_DB = 'audit.db';

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function auditPaths(baseDir: string) {
  const root = laforgePaths(baseDir).root;
  return {
    dir: path.join(root, AUDIT_DIR),
    file: path.join(root, AUDIT_DIR, AUDIT_FILE),
    db: path.join(root, AUDIT_DIR, AUDIT_DB),
  };
}

function parseSince(since?: string): Date | null {
  if (!since) return null;
  const rel = since.trim();
  const match = rel.match(/^(\d+)([smhd])$/i);
  if (match) {
    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    const now = Date.now();
    const ms =
      unit === 's' ? value * 1000 : unit === 'm' ? value * 60_000 : unit === 'h' ? value * 3_600_000 : value * 86_400_000;
    return new Date(now - ms);
  }
  const parsed = new Date(rel);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function matchesFilter(entry: AuditEntry, filters: AuditFilters): boolean {
  if (filters.tenant && entry.tenantId !== filters.tenant) return false;
  if (filters.model && entry.model !== filters.model) return false;
  if (filters.action && entry.type !== filters.action) return false;
  if (filters.type && entry.type !== filters.type) return false;
  if (filters.user && entry.userId !== filters.user) return false;
  const sinceDate = parseSince(filters.since);
  if (sinceDate && new Date(entry.timestamp) < sinceDate) return false;
  return true;
}

function mapRow(row: any): AuditEntry {
  const parsedData = row.data ? safeParseJson(row.data) : undefined;
  return {
    id: row.id,
    timestamp: row.timestamp,
    type: row.type,
    userId: row.user_id ?? row.userId,
    tenantId: row.tenant_id ?? row.tenantId,
    requestId: row.request_id ?? row.requestId,
    model: row.model,
    artifactHash: row.artifact_hash ?? row.artifactHash,
    data: parsedData,
  };
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function readFromDb(baseDir: string, filters: AuditFilters, limit: number): Promise<AuditEntry[]> {
  const { db } = auditPaths(baseDir);
  if (!(await fileExists(db))) return [];
  const conn = new DatabaseConnection(db);
  const clauses: string[] = [];
  const params: any[] = [];

  if (filters.tenant) {
    clauses.push(`tenant_id = $${params.length + 1}`);
    params.push(filters.tenant);
  }
  if (filters.model) {
    clauses.push(`model = $${params.length + 1}`);
    params.push(filters.model);
  }
  if (filters.action) {
    clauses.push(`type = $${params.length + 1}`);
    params.push(filters.action);
  }
  if (filters.user) {
    clauses.push(`user_id = $${params.length + 1}`);
    params.push(filters.user);
  }
  if (filters.since) {
    const sinceDate = parseSince(filters.since);
    if (sinceDate) {
      clauses.push(`timestamp >= $${params.length + 1}`);
      params.push(sinceDate.toISOString());
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await conn.query(
    `SELECT * FROM laforge_audit_log ${where} ORDER BY timestamp DESC LIMIT $${params.length + 1}`,
    [...params, limit],
  );
  conn.close();
  return rows.map(mapRow);
}

async function readFromFile(baseDir: string, filters: AuditFilters, limit: number): Promise<AuditEntry[]> {
  const { file } = auditPaths(baseDir);
  if (!(await fileExists(file))) return [];
  const raw = await fs.readFile(file, 'utf8');
  const entries = raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => safeParseJson(line) as AuditEntry)
    .filter(e => e && typeof e === 'object' && 'timestamp' in (e as any)) as AuditEntry[];

  const filtered = entries.filter(e => matchesFilter(e, filters));
  return filtered.sort((a, b) => (a.timestamp > b.timestamp ? -1 : 1)).slice(0, limit);
}

export async function listAuditEntries(
  filters: AuditFilters = {},
  options: { limit?: number; baseDir?: string } = {},
): Promise<AuditEntry[]> {
  const limit = options.limit || 100;
  const baseDir = options.baseDir || process.cwd();
  const fromDb = await readFromDb(baseDir, filters, limit);
  if (fromDb.length) return fromDb;
  return readFromFile(baseDir, filters, limit);
}

export async function tailAuditEntries(
  filters: AuditFilters = {},
  options: { limit?: number; baseDir?: string } = {},
): Promise<AuditEntry[]> {
  return listAuditEntries(filters, { ...options, limit: options.limit ?? 20 });
}

export async function getAuditEntryById(id: string, baseDir = process.cwd()): Promise<AuditEntry | undefined> {
  const entries = await listAuditEntries({}, { baseDir, limit: 5000 });
  return entries.find(e => e.id === id);
}
