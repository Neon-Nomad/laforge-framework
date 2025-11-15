import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { compileForSandbox } from '../packages/compiler/index.js';
import { writeCompilationOutput } from '../packages/cli/commands/utils.js';

test('forge compile end-to-end produces generated assets', async () => {
  const examplePath = path.resolve('examples/simple-blog/domain.ts');
  const source = await fs.readFile(examplePath, 'utf8');
  const output = compileForSandbox(source);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laforge-'));
  const files = await writeCompilationOutput(examplePath, output, tmpDir);

  const schema = await fs.readFile(path.join(tmpDir, 'sql', 'schema.sql'), 'utf8');
  expect(schema).toContain('CREATE TABLE IF NOT EXISTS users');
  expect(files.length).toBeGreaterThan(0);

  await fs.rm(tmpDir, { recursive: true, force: true });
});
