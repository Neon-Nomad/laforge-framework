import { expect, test } from 'vitest';
import { generateMigrations } from '../compiler/diffing/migrationGenerator.js';
import type { ModelDefinition } from '../compiler/ast/types.js';

const model = (name: string, schema: Record<string, any>, relations = []): ModelDefinition => ({
  name,
  schema,
  relations,
  policies: {},
  hooks: [],
  extensions: [],
});

test('generates rename column migration', () => {
  const before = [model('Post', { id: { type: 'uuid', primaryKey: true }, title: { type: 'string' } })];
  const after = [model('Post', { id: { type: 'uuid', primaryKey: true }, headline: { type: 'string' } })];

  const [migration] = generateMigrations(after, {
    previousModels: before,
    migrations: { allowDestructive: true },
  });

  expect(migration.content).toContain('RENAME COLUMN title TO headline');
});

test('creates nullability and default migrations', () => {
  const before = [model('Task', { id: { type: 'uuid', primaryKey: true }, note: { type: 'text', optional: true, default: "'draft'" } })];
  const after = [model('Task', { id: { type: 'uuid', primaryKey: true }, note: { type: 'text', optional: false, default: "'ready'" } })];

  const [migration] = generateMigrations(after, {
    previousModels: before,
    migrations: { allowDestructive: true },
  });

  expect(migration.content).toMatch(/SET NOT NULL/);
  expect(migration.content).toMatch(/SET DEFAULT 'ready'/);
});

test('blocks destructive operations in safe mode', () => {
  const before = [model('Log', { id: { type: 'uuid', primaryKey: true }, level: { type: 'string' } })];
  const after = [model('Log', { id: { type: 'uuid', primaryKey: true }, level: { type: 'integer' } })];

  const [migration] = generateMigrations(after, {
    previousModels: before,
    migrations: { allowDestructive: false },
  });

  expect(migration.content).toContain('WARNING: Destructive change skipped');
  expect(migration.content).not.toContain('ALTER TABLE log');
});

test('supports table rename detection', () => {
  const before = [model('Article', { id: { type: 'uuid', primaryKey: true }, title: { type: 'string' } })];
  const after = [model('Post', { id: { type: 'uuid', primaryKey: true }, title: { type: 'string' } })];

  const [migration] = generateMigrations(after, {
    previousModels: before,
    migrations: { allowDestructive: true },
  });

  expect(migration.content).toMatch(/RENAME TO posts/);
});
