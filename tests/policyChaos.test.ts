import { describe, expect, it } from 'vitest';
import { LaForgeRuntime } from '../packages/runtime/index.js';
import { DatabaseConnection } from '../packages/runtime/db/database.js';
import { runPolicyChaos, type ChaosCase } from '../packages/runtime/policyChaos.js';

const dsl = `
roles { admin user analyst }
claims { can.manage.posts }

model Post {
  id: uuid pk
  title: string
  authorId: uuid
}

permissions {
  model Post {
    create: admin | analyst
    read: user | can.manage.posts
    update: admin | analyst
    delete: admin
  }
}
`;

const defaultTenant = 't1';
const validAuthorId = '00000000-0000-0000-0000-000000000001';

function user(id: string, role: string, claims: Record<string, unknown> = {}): any {
  return { id, tenantId: defaultTenant, role, roles: [role], claims };
}

describe('policy chaos fuzz harness', () => {
  it('keeps over-allow and over-deny in check', { timeout: 20000 }, async () => {
    const db = new DatabaseConnection(':memory:');
    const runtime = new LaForgeRuntime(db);
    await runtime.compile(dsl);

    const admin = user('admin', 'admin');
    const author = user('author', 'analyst');

    await runtime.execute('Post', 'create', admin, { id: 'p1', title: 'Hello', authorId: validAuthorId });

    const tests: ChaosCase[] = [];

    // Expected denies for create
    for (let i = 0; i < 5; i++) {
      tests.push({
        model: 'Post',
        operation: 'create',
        user: user(`u-deny-${i}`, 'user'),
        data: { id: `denied-${i}`, title: 'X', authorId: validAuthorId },
        expect: 'deny',
        note: 'create requires admin or analyst',
      });
    }

    // Expected allows for create/update/delete by privileged roles
    tests.push({ model: 'Post', operation: 'create', user: admin, data: { id: 'p2', title: 'World', authorId: validAuthorId }, expect: 'allow' });
    // Claim-based read should allow without role
    tests.push({ model: 'Post', operation: 'findById', user: user('claim-user', 'user', { 'can.manage.posts': true }), data: { id: 'p1' }, expect: 'allow' });
    // Role-only read allowed
    tests.push({ model: 'Post', operation: 'findById', user: author, data: { id: 'p1' }, expect: 'allow' });
    tests.push({ model: 'Post', operation: 'update', user: admin, data: { id: 'p1', title: 'Updated' }, expect: 'allow' });
    tests.push({ model: 'Post', operation: 'delete', user: admin, data: { id: 'p1' }, expect: 'allow' });

    const res = await runPolicyChaos(runtime, tests);
    if (res.failures.length) {
      // Surface first failure for debugging
      const first = res.failures[0];
      throw new Error(`Chaos failure on ${first.test.operation} by ${first.test.user.role}: expected ${first.test.expect}, got ${first.result.success ? 'allow' : 'deny'} (${first.result.error || 'no error'})`);
    }
    expect(res.failures.length).toBe(0);
  });
});
