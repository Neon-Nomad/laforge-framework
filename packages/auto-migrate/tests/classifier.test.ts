import { describe, expect, it } from 'vitest';

import { classifyErrors } from '../src/classifier/index.js';

describe('classifier', () => {
  it('detects known Postgres error patterns', () => {
    const logs = [
      'ERROR: relation "posts" does not exist',
      'ERROR: column "rating" of relation "posts" does not exist',
      'ERROR: insert or update on table "comments" violates foreign key constraint "comments_post_id_fkey"',
      'ERROR: column "rating" is of type integer but expression is of type text',
      'ERROR: invalid input syntax for type integer: "abc"',
      'ERROR: cannot drop table "posts" because other objects depend on it',
    ];

    const errors = classifyErrors(logs);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'missing_table', table: 'posts' }),
        expect.objectContaining({ kind: 'missing_column', column: 'rating', table: 'posts' }),
        expect.objectContaining({ kind: 'foreign_key', constraint: 'comments_post_id_fkey' }),
        expect.objectContaining({ kind: 'type_mismatch', column: 'rating', expectedType: 'integer', providedType: 'text' }),
        expect.objectContaining({ kind: 'invalid_default', expectedType: 'integer' }),
        expect.objectContaining({ kind: 'drop_blocked' }),
      ]),
    );
  });

  it('falls back to unknown errors when nothing matches', () => {
    const errors = classifyErrors(['ERROR: unexpected failure']);
    expect(errors[0]).toEqual(
      expect.objectContaining({
        kind: 'unknown',
        message: expect.stringContaining('unexpected failure'),
      }),
    );
  });
});
