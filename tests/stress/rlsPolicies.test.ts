import { describe, expect, test } from 'vitest';
import { compileForSandbox } from '../../packages/compiler/index.ts';

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
    // Expected: unsupported user.org access should surface as a clear compilation failure.
    expect(() => compileForSandbox(dsl)).toThrow(/Unsupported user property/i);
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
