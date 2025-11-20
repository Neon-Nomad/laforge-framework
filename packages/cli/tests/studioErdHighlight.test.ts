import { describe, expect, it } from 'vitest';
import { highlightFromDiff } from '../commands/studio.js';
import type { SchemaOperation } from '../../compiler/diffing/schemaDiff.js';

describe('highlightFromDiff', () => {
  it('marks tables, fields, and edges from schema operations', () => {
    const ops: SchemaOperation[] = [
      { kind: 'addTable', table: 'posts', columns: [] as any },
      { kind: 'addColumn', table: 'posts', column: { name: 'title' } as any },
      { kind: 'renameColumn', table: 'posts', from: 'title', to: 'headline' },
      { kind: 'addForeignKey', fk: { table: 'posts', column: 'author_id', targetTable: 'users', targetColumn: 'id' } },
    ];

    const res = highlightFromDiff(ops);
    expect(res.changedTables.has('posts')).toBe(true);
    expect(res.changedFields.get('posts')?.has('title')).toBe(true);
    expect(res.changedFields.get('posts')?.has('headline')).toBe(true);
    expect(res.changedEdges.has('posts->users')).toBe(true);
  });
});

