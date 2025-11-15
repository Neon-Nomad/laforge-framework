import { expect, test } from 'vitest';
import { generateMigrations } from '../packages/compiler/diffing/migrationGenerator.js';
import type { ModelDefinition } from '../packages/compiler/ast/types.js';

test('SQL generator produces tables and constraints', () => {
  const models: ModelDefinition[] = [
    {
      name: 'User',
      schema: {
        id: { type: 'uuid', primaryKey: true },
        email: { type: 'string' },
      },
      relations: [],
      policies: {},
      hooks: [],
      extensions: [],
    },
    {
      name: 'Post',
      schema: {
        id: { type: 'uuid', primaryKey: true },
        title: { type: 'string' },
        authorId: { type: 'uuid' },
      },
      relations: [
        { name: 'author', type: 'belongsTo', targetModelName: 'User', foreignKey: 'authorId' },
      ],
      policies: {},
      hooks: [],
      extensions: [],
    },
  ];

  const migrations = generateMigrations(models, { useSchemas: false });
  expect(migrations[0].content).toContain('CREATE TABLE IF NOT EXISTS users');
  expect(migrations[0].content).toContain('CREATE TABLE IF NOT EXISTS posts');
  expect(migrations[0].content).toMatch(/FOREIGN KEY \(author_id\).*REFERENCES users/);
});
