import { describe, expect, test, vi } from 'vitest';

const execSpy = vi.fn();
const closeSpy = vi.fn();

vi.mock('../packages/runtime/db/mysql.js', async () => {
  const actual = await vi.importActual<any>('../packages/runtime/db/mysql.js');
  return {
    ...actual,
    MySQLConnection: vi.fn(function MockMySQL(this: any) {
      return {
        exec: execSpy,
        execMany: execSpy,
        close: closeSpy,
      };
    }),
  };
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateIncrementalMigration, applyMigrations } from '../packages/cli/lib/persistence.js';

const domainV1 = `
model User {
  id: uuid pk
  email: string
}
`;

async function writeDomain(dir: string, content: string) {
  const file = path.join(dir, 'domain.ts');
  await fs.writeFile(file, content, 'utf8');
  return file;
}

describe('mysql migration apply path', () => {
  test('applyMigrations uses MySQLConnection for mysql URLs', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-mysql-'));
    const domainFile = await writeDomain(tmp, domainV1);
    await generateIncrementalMigration({ domainFile, baseDir: tmp });

    await applyMigrations({ baseDir: tmp, dbPath: 'mysql://user:pass@localhost/db' });
    expect(execSpy).toHaveBeenCalled();
  });
});
