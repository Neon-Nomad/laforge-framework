import { describe, expect, test } from 'vitest';
import { parseForgeDsl } from '../../packages/compiler/index.ts';
import { generateMigrations } from '../../packages/compiler/diffing/migrationGenerator.ts';

describe('Stress: diff and migration churn', () => {
  test('skips destructive drops when allowDestructive=false and reports warnings', () => {
    const before = parseForgeDsl(`
model Temp {
  id: uuid pk
  name: string
}
`);

    const after = parseForgeDsl(`
model Temp {
  id: uuid pk
  description: string
}
`);

    const migrations = generateMigrations(after, {
      previousModels: before,
      migrations: { allowDestructive: false },
    });

    const content = migrations[0].content;
    // Expected: safe rename detection should avoid destructive drops entirely.
    expect(content).toMatch(/RENAME COLUMN/i);
    expect(content).not.toMatch(/DROP COLUMN/i);
  });

  test('prefers alter type over drop+add for type reversions', () => {
    const prev = parseForgeDsl(`
model Thing { id: uuid pk, size: int }
`);
    const next = parseForgeDsl(`
model Thing { id: uuid pk, size: string }
`);
    const migrations = generateMigrations(next, { previousModels: prev, migrations: { allowDestructive: true } });
    const content = migrations[0].content;

    // Expected: emit ALTER TYPE not DROP/ADD churn.
    expect(content).toMatch(/ALTER/i);
    expect(content).not.toMatch(/DROP COLUMN/i);
  });

  test('handles table drop + recreate in one migration without losing dependent FKs', () => {
    const prev = parseForgeDsl(`
model Parent { id: uuid pk }
model Child { id: uuid pk, parent: belongsTo(Parent) }
`);
    const next = parseForgeDsl(`
model Parent { id: uuid pk, name: string }
model Child { id: uuid pk, parent: belongsTo(Parent) }
`);
    const migrations = generateMigrations(next, {
      previousModels: prev,
      migrations: { allowDestructive: true },
    });
    const content = migrations[0].content;

    // Expected: FK recreation should appear alongside parent table change.
    expect(content).toMatch(/FOREIGN KEY/i);
    expect(content).toMatch(/parent/);
  });

  test('massive schema changes emit granular operations, not a single drop-and-recreate', () => {
    const prev = parseForgeDsl(`
model Legacy {
  id: uuid pk
  name: string
  kind: string
}
`);
    const next = parseForgeDsl(`
model Legacy {
  id: uuid pk
  title: string
  kind: int
  state: string optional
  archivedAt: datetime optional
}
`);

    const migrations = generateMigrations(next, { previousModels: prev, migrations: { allowDestructive: true } });
    const content = migrations[0].content;

    // Expected: multiple ALTER/RENAME statements; current implementation tends to drop columns instead.
    expect(content).toMatch(/ALTER|RENAME/i);
    expect(content).not.toMatch(/DROP TABLE/i);
  });
});
