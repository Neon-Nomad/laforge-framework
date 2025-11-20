import { describe, expect, it } from 'vitest';
import { AuditLogger } from '../audit.js';
import { DatabaseConnection } from '../db/database.js';

describe('AuditLogger', () => {
  it('persists events to an append-only table', async () => {
    const db = new DatabaseConnection(':memory:');
    const audit = new AuditLogger(db);

    audit.record('test', { userId: 'u1', tenantId: 't1', model: 'Post', data: { foo: 'bar' } });

    const res = await db.query('SELECT * FROM laforge_audit_log', []);
    expect(res.rows).toHaveLength(1);
    const row = res.rows[0];
    expect(row.type).toBe('test');
    expect(row.user_id).toBe('u1');
    expect(JSON.parse(row.data).foo).toBe('bar');

    expect(() => db.exec("UPDATE laforge_audit_log SET type = 'other'")).toThrow();
    expect(() => db.exec('DELETE FROM laforge_audit_log')).toThrow();

    db.close();
  });
});
