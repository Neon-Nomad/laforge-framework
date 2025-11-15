import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { LaForgeRuntime } from './dist/packages/runtime/index.js';

async function runCLIgenerate(domainFile) {
  const cliPath = path.resolve('./dist/packages/cli/index.js');

  await new Promise((resolve, reject) => {
    const child = spawn('node', [cliPath, 'generate', domainFile, '--db', 'sqlite'], {
      cwd: process.cwd(),
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`forge generate exited with code ${code}`));
      }
    });
  });
}

async function main() {
  await fs.mkdir('.laforge', { recursive: true });
  await fs.rm('.laforge/dev.db', { force: true });

  const runtime = new LaForgeRuntime(new Database('.laforge/dev.db'));

  // step 1: generate artifacts
  await runCLIgenerate('test-domain.ts');

  // step 2: load generated output
  await runtime.initializeFromGenerated();

  // step 3: run domain ops
  const user = { id: randomUUID(), tenantId: randomUUID(), role: 'admin' };
  const data = { id: randomUUID(), email: 'user@example.com', role: 'member' };

  const createResult = await runtime.execute('User', 'create', user, data);
  if (!createResult.success) {
    throw new Error(`Create failed: ${createResult.error}`);
  }
  console.log('User created successfully');

  const listResult = await runtime.execute('User', 'list', user);
  if (!listResult.success) {
    throw new Error(`List failed: ${listResult.error}`);
  }
  console.log('List returns the created user', listResult.data);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
