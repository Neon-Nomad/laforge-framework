import { describe, expect, test } from 'vitest';
import { compileForSandbox, parseForgeDsl } from '../../packages/compiler/index.js';
import { generateMigrations } from '../../packages/compiler/diffing/migrationGenerator.js';

describe('Stress: complex schemas', () => {
  test('detects cyclic relations instead of silently generating invalid FKs', () => {
    const cyclicDsl = `
model Alpha {
  id: uuid pk
  beta: belongsTo(Beta)
}

model Beta {
  id: uuid pk
  gamma: belongsTo(Gamma)
}

model Gamma {
  id: uuid pk
  alpha: belongsTo(Alpha)
}
`;
    // Expected: compiler should reject cycles with a clear error so migrations do not emit broken FKs.
    expect(() => compileForSandbox(cyclicDsl)).toThrow(/cycle|cyclic|recursive/i);
  });

  test('preserves cascading delete semantics across multi-hop FKs', () => {
    const dsl = `
model Company {
  id: uuid pk
}

model Team {
  id: uuid pk
  companyId: uuid
  parentTeam: belongsTo(Team)
}

model Member {
  id: uuid pk
  teamId: uuid
  managerId: uuid optional
}
`;
    const output = compileForSandbox(dsl);
    // Expected: every FK in the nested chain should emit ON DELETE CASCADE to avoid orphans.
    // Current generator does not render cascading clauses, so this will fail until added.
    expect(output.sql).toMatch(/ON DELETE CASCADE/i);
    expect(output.sql).toMatch(/team_id.*ON DELETE CASCADE/i);
    expect(output.sql).toMatch(/company_id.*ON DELETE CASCADE/i);
  });

  test('emits table/column rename operations for rename chains instead of drop + recreate', () => {
    const prevDsl = `
model A {
  id: uuid pk
  name: string
}
`;
    const nextDsl = `
model C {
  id: uuid pk
  displayName: string
}
`;

    const previousModels = parseForgeDsl(prevDsl);
    const nextModels = parseForgeDsl(nextDsl);

    const migrations = generateMigrations(nextModels, {
      previousModels,
      migrations: { allowDestructive: false },
    });
    const content = migrations[0].content;

    // Expected: renameTable/renameColumn operations, NOT drop/add (which would lose data).
    expect(content).toMatch(/rename/i);
    expect(content).not.toMatch(/DROP TABLE/i);
    expect(content).not.toMatch(/DROP COLUMN/i);
  });

  test('supports models with 3+ foreign keys and mixed nullability', () => {
    const dsl = `
model LedgerEntry {
  id: uuid pk
  debitAccountId: uuid
  creditAccountId: uuid
  journalId: uuid optional
  attachmentId: uuid optional
}

model Account { id: uuid pk }
model Journal { id: uuid pk }
model Attachment { id: uuid pk }
`;
    const output = compileForSandbox(dsl);
    // Expected: SQL should include ALL four FKs and honor optionality (nullable columns).
    expect(output.sql).toMatch(/debit_account_id UUID NOT NULL/i);
    expect(output.sql).toMatch(/credit_account_id UUID NOT NULL/i);
    expect(output.sql).toMatch(/journal_id UUID/i);
    expect(output.sql).toMatch(/attachment_id UUID/i);
    // Current generator drops relation-based columns; this should fail until fixed.
  });
});
