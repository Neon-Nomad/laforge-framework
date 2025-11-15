import { expect, test } from 'vitest';
import { computeSchemaDiff, formatSchemaDiff } from '../compiler/diffing/schemaDiff.js';
import type { ModelDefinition } from '../compiler/ast/types.js';

const model = (name: string, schema: Record<string, any>): ModelDefinition => ({
  name,
  schema,
  relations: [],
  policies: {},
  hooks: [],
  extensions: [],
});

test('detects column additions, drops, and renames', () => {
  const before = [model('User', { id: { type: 'uuid', primaryKey: true }, email: { type: 'string' } })];
  const after = [model('User', { id: { type: 'uuid', primaryKey: true }, username: { type: 'string' }, phone: { type: 'string' } })];

  const diff = computeSchemaDiff(before, after);
  const kinds = diff.operations.map(op => op.kind);

  expect(kinds).toContain('renameColumn');
  expect(kinds).toContain('addColumn');
  expect(kinds).not.toContain('dropColumn');
});

test('tracks type, nullability, and default changes', () => {
  const before = [
    model('Post', {
      id: { type: 'uuid', primaryKey: true },
      title: { type: 'string' },
      body: { type: 'text', optional: true, default: "'draft'" },
    }),
  ];
  const after = [
    model('Post', {
      id: { type: 'uuid', primaryKey: true },
      title: { type: 'text' }, // type change
      body: { type: 'text', optional: false, default: "'published'" }, // nullability + default change
    }),
  ];

  const diff = computeSchemaDiff(before, after);
  const kinds = diff.operations.map(op => op.kind);

  expect(kinds).toContain('alterColumnType');
  expect(kinds).toContain('alterNullability');
  expect(kinds).toContain('alterDefault');
});

test('emits warnings on drops', () => {
  const before = [model('Comment', { id: { type: 'uuid', primaryKey: true }, text: { type: 'text' } })];
  const after: ModelDefinition[] = [];

  const diff = computeSchemaDiff(before, after);
  expect(diff.warnings.length).toBeGreaterThan(0);
  expect(formatSchemaDiff(diff)).toContain('drop table');
});

test('json shape is stable for CI output', () => {
  const before = [model('Foo', { id: { type: 'uuid', primaryKey: true }, name: { type: 'string' } })];
  const after = [model('Foo', { id: { type: 'uuid', primaryKey: true }, name: { type: 'string' }, alias: { type: 'string' } })];

  const diff = computeSchemaDiff(before, after);
  const serialized = JSON.parse(JSON.stringify(diff));

  expect(serialized.operations[0].kind).toBeDefined();
  expect(Array.isArray(serialized.warnings)).toBe(true);
});
