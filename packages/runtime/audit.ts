import fs from 'node:fs/promises';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseConnection } from './db/database.js';

export interface AuditEvent {
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

/**
 * Append-only audit logger. Stores events in memory for tests and,
 * when provided a DatabaseConnection, persists them to a durable table
 * with triggers preventing update/delete.
 */
export class AuditLogger {
  private logs: AuditEvent[] = [];
  private initialized = false;
  private logFilePath?: string;
  private db?: DatabaseConnection;
  constructor(options?: DatabaseConnection | { db?: DatabaseConnection; logFilePath?: string }) {
    if (options && options instanceof DatabaseConnection) {
      this.db = options;
    } else if (options && typeof options === 'object') {
      this.db = options.db;
      this.logFilePath = options.logFilePath;
    }
  }

  private ensureTable(): void {
    if (!this.db || this.initialized) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS laforge_audit_log (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        user_id TEXT,
        tenant_id TEXT,
        request_id TEXT,
        model TEXT,
        artifact_hash TEXT,
        data TEXT
      );
      CREATE TRIGGER IF NOT EXISTS laforge_audit_log_no_update
      AFTER UPDATE ON laforge_audit_log
      BEGIN
        SELECT RAISE(ABORT, 'audit log is append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS laforge_audit_log_no_delete
      AFTER DELETE ON laforge_audit_log
      BEGIN
        SELECT RAISE(ABORT, 'audit log is append-only');
      END;
    `);
    this.initialized = true;
  }

  record(type: string, details: Omit<AuditEvent, 'id' | 'timestamp' | 'type'> = {}): void {
    const event: AuditEvent = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      type,
      ...details,
    };
    this.logs.push(event);

    if (this.db) {
      this.ensureTable();
      const params = [
        event.id,
        event.timestamp,
        event.type,
        event.userId ?? null,
        event.tenantId ?? null,
        event.requestId ?? null,
        event.model ?? null,
        event.artifactHash ?? null,
        event.data ? JSON.stringify(event.data) : null,
      ];
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.db.query(
        `INSERT INTO laforge_audit_log
        (id, timestamp, type, user_id, tenant_id, request_id, model, artifact_hash, data)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`,
        params,
      );
    }
    if (this.logFilePath) {
      void this.appendToFile(event);
    }
  }

  getLogs(): AuditEvent[] {
    return this.logs;
  }

  clear(): void {
    this.logs = [];
  }

  private async appendToFile(event: AuditEvent): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.logFilePath!), { recursive: true });
      await fs.appendFile(this.logFilePath!, JSON.stringify(event) + '\n', 'utf8');
    } catch (err) {
      console.error('Failed to append audit log:', (err as any)?.message || err);
    }
  }
}
