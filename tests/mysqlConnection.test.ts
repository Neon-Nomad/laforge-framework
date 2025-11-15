import { describe, expect, test, vi, beforeEach } from 'vitest';

const querySpy = vi.fn().mockResolvedValue([[], undefined]);
const endSpy = vi.fn().mockResolvedValue(undefined);

vi.mock('mysql2/promise', () => ({
  default: { createPool: () => ({ query: querySpy, end: endSpy }) },
  createPool: () => ({ query: querySpy, end: endSpy }),
}));

import { MySQLConnection } from '../runtime/db/mysql.js';

beforeEach(() => {
  querySpy.mockClear();
  endSpy.mockClear();
});

describe('MySQLConnection', () => {
  test('query normalizes rows', async () => {
    const conn = new MySQLConnection('mysql://user:pass@localhost/db');
    const res = await conn.query('SELECT 1');
    expect(res.rows).toEqual([]);
    expect(res.rowCount).toBe(0);
  });

  test('execMany splits multiple statements', async () => {
    const conn = new MySQLConnection('mysql://user:pass@localhost/db');
    await conn.execMany(['SELECT 1; SELECT 2;']);
    expect(querySpy).toHaveBeenCalledTimes(2);
  });
});
