import { describe, expect, it } from 'vitest';

import { repairMigration } from '../src/repair/index.js';
import type { ClassifiedError } from '../src/contract.js';

describe('repairMigration', () => {
  it('injects stubs and alters statements for known errors', () => {
    const errors: ClassifiedError[] = [
      { kind: 'missing_table', message: '', table: 'posts' },
      { kind: 'missing_column', message: '', table: 'posts', column: 'title', expectedType: 'text' },
      { kind: 'type_mismatch', message: '', table: 'posts', column: 'rating', expectedType: 'integer' },
      { kind: 'invalid_default', message: '', table: 'posts', column: 'title' },
      { kind: 'drop_blocked', message: '' },
      { kind: 'foreign_key', message: '' },
    ];

    const originalSql = `
DROP TABLE "posts";
CREATE TABLE "posts"(id uuid primary key);
ALTER TABLE "posts"
  ADD CONSTRAINT posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
`;

    const repaired = repairMigration(originalSql, errors);

    expect(repaired).toContain('CREATE TABLE IF NOT EXISTS "posts"');
    expect(repaired).toContain('ADD COLUMN IF NOT EXISTS "title" text;');
    expect(repaired).toContain('ALTER COLUMN "rating" TYPE integer USING "rating"::integer;');
    expect(repaired).toContain('ALTER COLUMN "title" DROP DEFAULT;');
    expect(repaired).toMatch(/-- Auto-migrate disabled: DROP TABLE "posts";/);

    const fkIndex = repaired.lastIndexOf('FOREIGN KEY');
    const createIndex = repaired.indexOf('CREATE TABLE "posts"');
    expect(createIndex).toBeLessThan(fkIndex);
  });

  it('wraps SQL in transaction guard for unknown errors', () => {
    const repaired = repairMigration('SELECT 1;', [{ kind: 'unknown', message: 'boom' }]);
    expect(repaired).toContain('DO $$');
    expect(repaired).toContain('SAVEPOINT auto_migrate_guard;');
  });
});
