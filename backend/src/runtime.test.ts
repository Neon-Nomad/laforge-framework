import { expect, test } from 'vitest';
import { LaForgeRuntime } from './runtime.js';
import type { DatabaseConnection } from './database.js';

const createRuntime = () => {
  const dummyDb: Partial<DatabaseConnection> = {
    exec: () => {
      // no-op for tests
    },
    query: async () => ({
      rows: [],
      rowCount: 0
    })
  };
  return new LaForgeRuntime(dummyDb as DatabaseConnection);
};

test('VM boots with require and module', () => {
  const rt = createRuntime();
  const mod = rt['evaluateModule'](`module.exports = 123;`, []);
  expect(mod.exports).toBe(123);
});

test('Zod schema evaluation succeeds', () => {
  const rt = createRuntime();
  const code = `
    const z = require('zod');
    module.exports = { schema: z.string() };
  `;
  const result = rt['evaluateModule'](code, ['zod']);
  expect(result.exports.schema).toBeDefined();
});

test('SQL module loads correctly', () => {
  const rt = createRuntime();
  (rt as any).sqlQueries = { test: 'SELECT 1' };
  const code = `
    const sql = require('./sql');
    module.exports = sql;
  `;
  const result = rt['evaluateModule'](code, ['./sql']);
  expect(result.exports.test).toBe('SELECT 1');
});

test('Blocked require throws error', () => {
  const rt = createRuntime();
  const attempt = () => rt['evaluateModule'](`(() => require('fs'))();`, []);
  expect(attempt).toThrow(/Blocked require/);
});

test('Unsafe top-level require is detected', () => {
  const rt = createRuntime();
  const code = `require('zod'); module.exports = {};`;
  expect(() => rt['evaluateModule'](code, ['zod'])).toThrow(/Disallowed top-level require/);
});

test('Wrapper returns module.exports', () => {
  const rt = createRuntime();
  const result = rt['evaluateModule'](`module.exports = { ok: true };`, []);
  expect(result.exports.ok).toBe(true);
});

test('global and globalThis match sandbox', () => {
  const rt = createRuntime();
  const code = `
    module.exports = {
      isSame: global === globalThis
    };
  `;
  const result = rt['evaluateModule'](code, []);
  expect(result.exports.isSame).toBe(true);
});
