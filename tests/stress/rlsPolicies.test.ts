import { describe, expect, test } from 'vitest';
import { compileForSandbox } from '../../packages/compiler/index.js';

describe('Stress: complex RLS policies', () => {
  test('rejects policies that reference non-existent fields', () => {
    const dsl = `
model Invoice {
  id: uuid pk
  tenantId: uuid tenant
  total: int
}

policy Invoice.read {
  ({ user, record }) => record.missingField === user.id
}
`;
    // Expected: compilation should fail with a clear error about missingField not existing.
    expect(() => compileForSandbox(dsl)).toThrow(/missingField|undefined field/i);
  });

  test('detects nested boolean logic that short-circuits multi-tenant isolation', () => {
    const dsl = `
model Post {
  id: uuid pk
  tenantId: uuid tenant
  authorId: uuid
}

policy Post.read {
  ({ user, record }) => (user.role === "admin" || record.tenantId === user.tenantId) && (user.org === record.org)
}
`;
    const output = compileForSandbox(dsl);
    // Expected: generated RLS/policy SQL should preserve parentheses to avoid leaking records.
    // Failure mode: generator flattens logic and produces incorrect precedence.
    expect(output.rls).toMatch(/\(user\.role.*admin.*\)\s+OR\s+\(record\.tenantId/i);
    expect(output.rls).toMatch(/\)\s+AND\s+\(user\.org/i);
  });

  test('fails fast on string interpolation inside policy expressions', () => {
    const dsl = `
model Secret {
  id: uuid pk
  tenantId: uuid tenant
}

policy Secret.read {
  ({ user }) => user.role === \`admin-\${user.tenantId}\`
}
`;
    // Expected: interpolation inside policies should be blocked or sanitized; compile should throw.
    expect(() => compileForSandbox(dsl)).toThrow(/interpolation|template|unsafe/i);
  });

  test('raises on policy order conflicts when both deny and allow exist', () => {
    const dsl = `
model Payment {
  id: uuid pk
  tenantId: uuid tenant
  status: string
}

policy Payment.read {
  ({ record, user }) => record.tenantId === user.tenantId
}

policy Payment.read {
  ({ record }) => record.status === "public"
}
`;
    // Expected: duplicate policy actions should error instead of generating ambiguous checks.
    expect(() => compileForSandbox(dsl)).toThrow(/duplicate|conflict|multiple policies/i);
  });
});
