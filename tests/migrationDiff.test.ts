import { expect, test } from 'vitest';
import { compileForSandbox } from '../packages/compiler/index.js';
import { diffSql } from '../packages/compiler/diffing/sqlDiff.js';

test('migration diff highlights schema changes', () => {
  const v1 = compileForSandbox(`
model User {
  id: uuid pk
  email: string
}
`);

  const v2 = compileForSandbox(`
model User {
  id: uuid pk
  email: string
  displayName: string
}
`);

  const diff = diffSql(v1.sql, v2.sql);
  expect(diff).toMatch(/\+\s+display_name VARCHAR\(255\)/);
});
