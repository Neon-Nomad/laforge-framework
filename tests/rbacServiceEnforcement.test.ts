import { describe, expect, it } from 'vitest';
import { LaForgeRuntime } from '../packages/runtime/index.js';
import { DatabaseConnection } from '../packages/runtime/db/database.js';

const dsl = `
roles { admin user }
claims { can.manage.posts }

model Post {
  id: uuid pk
  title: string
}

permissions {
  model Post {
    create: admin
    read: user | can.manage.posts
  }
}
`;

describe('RBAC enforcement in generated services', () => {
  it('denies create when user lacks required role', { timeout: 20000 }, async () => {
    const db = new DatabaseConnection(':memory:');
    const runtime = new LaForgeRuntime(db);
    await runtime.compile(dsl);

    const res = await runtime.execute(
      'Post',
      'create',
      { id: 'u1', tenantId: 't1', role: 'user', roles: ['user'], claims: {} },
      { id: 'p1', title: 'Hello' },
    );

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/permission/i);
  });

  it('allows create when user has required role', { timeout: 20000 }, async () => {
    const db = new DatabaseConnection(':memory:');
    const runtime = new LaForgeRuntime(db);
    await runtime.compile(dsl);

    const res = await runtime.execute(
      'Post',
      'create',
      { id: 'admin', tenantId: 't1', role: 'admin', roles: ['admin'], claims: {} },
      { id: 'p2', title: 'Hello' },
    );

    expect(res.success).toBe(true);
    expect(res.data?.title).toBe('Hello');
  });
});
