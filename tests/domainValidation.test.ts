import { describe, expect, it } from 'vitest';
import { compileForSandbox } from '../packages/compiler/index.js';

describe('Domain validation errors', () => {
  it('throws a friendly error when a model is missing a primary key', () => {
    const missingPkDsl = `
model Book {
  title: string
  author: string
}
`;
    expect(() => compileForSandbox(missingPkDsl)).toThrowError(
      /Model "Book" is missing a primary key/i,
    );
  });
});
