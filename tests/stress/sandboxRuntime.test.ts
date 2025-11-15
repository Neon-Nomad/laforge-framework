import { describe, expect, test } from 'vitest';
import { LaForgeRuntime } from '../../packages/runtime/index.ts';
import type { DatabaseConnection } from '../../packages/runtime/db/database.js';

const dummyDb: DatabaseConnection = {
  exec: () => {},
  // Query returns empty data but keeps shape
  query: async () => ({ rows: [], rowCount: 0 }),
  close: () => {},
  transaction: fn => fn(),
} as unknown as DatabaseConnection;

describe('Stress: sandbox and runtime hardening', () => {
  test('blocks Function constructor escape attempts', () => {
    const rt = new LaForgeRuntime(dummyDb);
    const escapeCode = `
      const fn = new Function('return globalThis.process');
      module.exports = fn();
    `;
    // Expected: runtime should refuse code using Function constructor to reach host objects.
    expect(() => rt['evaluateModule'](escapeCode, [])).toThrow(/Function|process|escape/i);
  });

  test('rejects compiled output with dangling require() even if wrapped', () => {
    const rt = new LaForgeRuntime(dummyDb);
    const code = `
      module.exports = (() => {
        const fs = require('fs');
        return fs.readFileSync('/etc/passwd', 'utf8');
      })();
    `;
    // Expected: evaluateModule should block nested requires, not just top-level ones.
    expect(() => rt['evaluateModule'](code, [])).toThrow(/Blocked require/i);
  });

  test('fails clearly when domain services export is missing', async () => {
    const rt = new LaForgeRuntime(dummyDb);
    const compiled = {
      sql: 'CREATE TABLE IF NOT EXISTS x(id UUID PRIMARY KEY);',
      zod: 'module.exports = { Schema: {} };',
      domain: 'class X { }',
      rls: '',
      routes: '',
      models: [{ name: 'X', schema: { id: { type: 'uuid', primaryKey: true } }, policies: {}, relations: [], hooks: [], extensions: [] }],
      migrations: [],
      config: { multiTenant: true },
    } as any;

    // Expected: loadCompiled should complain about missing exports instead of silently succeeding.
    await expect(rt.loadCompiled(compiled)).rejects.toThrow(/export|domain services/i);
  });

  test('surface invalid Zod generation rather than swallowing errors', () => {
    const rt = new LaForgeRuntime(dummyDb);
    const badZod = `
      const z = require('zod').z;
      // Missing module.exports causes silently empty exports today.
      z.object({ a: z.string() });
    `;
    // Expected: either exported object or explicit error; empty exports should be treated as failure.
    expect(() => rt['evaluateModule'](badZod, ['zod'])).toThrow(/export|empty|schema/i);
  });
});
