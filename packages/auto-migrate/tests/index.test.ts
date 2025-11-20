import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/sandbox', async () => {
  const actual = await vi.importActual<typeof import('../src/sandbox')>('../src/sandbox');
  return {
    ...actual,
    spawnSandbox: vi.fn(),
  };
});

import { runMigrationInSandbox } from '../src';
import { spawnSandbox, SandboxRunError } from '../src/sandbox';

describe('runMigrationInSandbox', () => {
  it('returns success when no errors are classified', async () => {
    vi.mocked(spawnSandbox).mockResolvedValue(['CREATE TABLE']);

    const result = await runMigrationInSandbox('CREATE TABLE test(id int);');

    expect(result.success).toBe(true);
    expect(result.logs).toEqual(['CREATE TABLE']);
  });

  it('captures errors and produces repaired SQL', async () => {
    vi.mocked(spawnSandbox).mockResolvedValue([
      'ERROR: relation "posts" does not exist',
    ]);

    const result = await runMigrationInSandbox('ALTER TABLE posts ADD COLUMN title text;');

    expect(result.success).toBe(false);
    expect(result.errors?.[0].kind).toBe('missing_table');
    expect(result.repairedSql).toContain('CREATE TABLE IF NOT EXISTS "posts"');
  });

  it('handles sandbox failures using error logs', async () => {
    const sandboxError = new SandboxRunError('docker failed', ['docker run failed']);
    vi.mocked(spawnSandbox).mockRejectedValue(sandboxError);

    const result = await runMigrationInSandbox('SELECT 1;');

    expect(result.success).toBe(false);
    expect(result.logs).toEqual(['docker run failed']);
    expect(result.errors?.[0].kind).toBeDefined();
  });
});
