import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { generateIncrementalMigration, applyMigrations, loadSnapshot, status } from '../packages/cli/lib/persistence.ts';
import { compileForSandbox } from '../packages/compiler/index.ts';
import { vi } from 'vitest';

const domainV1 = `
model User {
  id: uuid pk
  email: string
}
`;

const domainV2 = `
model User {
  id: uuid pk
  email: string
  displayName: string
}
`;

const domainV3 = `
model User {
  id: uuid pk
  email: string
  fullName: string
}
`;

async function writeDomain(dir: string, content: string) {
  const file = path.join(dir, 'domain.ts');
  await fs.writeFile(file, content, 'utf8');
  return file;
}

test(
  'snapshot created on initial generate and migrations accumulate',
  { timeout: 15000 },
  async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-inc-'));
    const domainFile = await writeDomain(tmp, domainV1);

  // initial migration (baseline)
  const first = await generateIncrementalMigration({ domainFile, baseDir: tmp, db: 'sqlite' });
  expect(first.migrationNames.length).toBeGreaterThan(0);

  const snapshot = await loadSnapshot(tmp);
  expect(snapshot.length).toBeGreaterThan(0);

  // second migration with added column
  await writeDomain(tmp, domainV2);
  const second = await generateIncrementalMigration({ domainFile, baseDir: tmp, db: 'sqlite' });
  expect(second.migrationNames.length).toBeGreaterThan(0);

  // third migration with rename (displayName -> fullName)
  await writeDomain(tmp, domainV3);
  const third = await generateIncrementalMigration({ domainFile, baseDir: tmp, db: 'sqlite' });
  expect(third.migrationNames.length).toBeGreaterThan(0);

  const migDir = path.join(tmp, '.laforge', 'migrations');
  const files = (await fs.readdir(migDir)).filter(f => f.endsWith('.sql'));
  expect(files.length).toBeGreaterThanOrEqual(3);

  // apply migrations to a sqlite file
  const dbPath = path.join(tmp, 'app.db');
  const applyResult = await applyMigrations({ baseDir: tmp, dbPath });
  expect(applyResult.applied.length).toBe(files.length);

    const st = await status(tmp);
    expect(st.pending.length).toBe(0);
  },
);

test('safe mode blocks destructive changes', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-safe-'));
  const domainFile = await writeDomain(tmp, domainV1);
  await generateIncrementalMigration({ domainFile, baseDir: tmp });

  // change type destructively
  const domainHard = `
model User {
  id: uuid pk
  email: integer
}
`;
  await fs.writeFile(domainFile, domainHard, 'utf8');
  const res = await generateIncrementalMigration({ domainFile, baseDir: tmp, allowDestructive: false });

  const migDir = path.join(tmp, '.laforge', 'migrations');
  const files = (await fs.readdir(migDir)).filter(f => f.endsWith('.sql'));
  const latest = await fs.readFile(path.join(migDir, files.sort().at(-1)!), 'utf8');
  expect(latest).toContain('WARNING');
});
