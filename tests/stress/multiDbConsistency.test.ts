import { describe, expect, test } from 'vitest';
import { parseForgeDsl } from '../../packages/compiler/index.ts';
import { generateMigrations } from '../../packages/compiler/diffing/migrationGenerator.ts';

describe('Stress: multi-DB consistency', () => {
  test('UUID defaults stay semantically equivalent across postgres/mysql/sqlite', () => {
    const models = parseForgeDsl(`
model Device {
  id: uuid pk
  label: string
  createdAt: datetime
}
`);
    const postgres = generateMigrations(models, { db: 'postgres' })[0].content;
    const mysql = generateMigrations(models, { db: 'mysql' })[0].content;
    const sqlite = generateMigrations(models, { db: 'sqlite' })[0].content;

    // Expected: all dialects should auto-generate UUIDs with equivalent defaults.
    expect(postgres).toMatch(/uuid_generate_v4/);
    expect(mysql).toMatch(/UUID\(\)/i);
    expect(sqlite).toMatch(/randomblob|uuid_generate_v4/i);
  });

  test('JSON types remain consistent across adapters', () => {
    const models = parseForgeDsl(`
model Event {
  id: uuid pk
  payload: json
}
`);
    const postgres = generateMigrations(models, { db: 'postgres' })[0].content;
    const mysql = generateMigrations(models, { db: 'mysql' })[0].content;
    const sqlite = generateMigrations(models, { db: 'sqlite' })[0].content;

    // Expected: JSON/JSONB/JSON equivalents should map correctly; currently SQLite/MySQL mappings are inconsistent.
    expect(postgres).toMatch(/JSONB?/i);
    expect(mysql).toMatch(/JSON\b/i);
    expect(sqlite).toMatch(/JSON/i);
  });

  test('case sensitivity and unique constraints match across dialects', () => {
    const models = parseForgeDsl(`
model User {
  id: uuid pk
  email: string unique
}
`);
    const postgres = generateMigrations(models, { db: 'postgres' })[0].content;
    const mysql = generateMigrations(models, { db: 'mysql' })[0].content;
    const sqlite = generateMigrations(models, { db: 'sqlite' })[0].content;

    // Expected: unique constraints modeled in DSL should appear identically; currently uniqueness is not emitted at all.
    expect(postgres).toMatch(/UNIQUE/i);
    expect(mysql).toMatch(/UNIQUE/i);
    expect(sqlite).toMatch(/UNIQUE/i);
  });
});
