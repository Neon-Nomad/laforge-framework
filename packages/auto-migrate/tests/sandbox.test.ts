import { describe, expect, it, vi, beforeEach } from 'vitest';

const childProcessMocks = vi.hoisted(() => {
  return {
    execFileSyncMock: vi.fn(),
    spawnSyncMock: vi.fn(),
  };
});

vi.mock('node:child_process', () => ({
  execFileSync: childProcessMocks.execFileSyncMock,
  spawnSync: childProcessMocks.spawnSyncMock,
}));

const { execFileSyncMock, spawnSyncMock } = childProcessMocks;

import { spawnSandbox, SandboxRunError } from '../src/sandbox/index.js';

describe('sandbox runner', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
    spawnSyncMock.mockReset();
  });

  it('applies migrations and collects stdout/stderr logs', async () => {
    execFileSyncMock.mockImplementation(() => undefined);
    spawnSyncMock.mockReturnValue({
      stdout: 'CREATE TABLE',
      stderr: 'NOTICE: relation created',
      status: 0,
      pid: 123,
      signal: null,
    });

    const logs = await spawnSandbox('CREATE TABLE test(id int);');

    expect(logs).toContain('CREATE TABLE');
    expect(logs).toContain('NOTICE: relation created');

    const dockerArgs = execFileSyncMock.mock.calls.map(([, args]) => args as string[]);
    expect(dockerArgs.some((args) => args[0] === 'run')).toBe(true);
    expect(dockerArgs.some((args) => args.includes('pg_isready'))).toBe(true);
    expect(dockerArgs.some((args) => args[0] === 'stop')).toBe(true);
  });

  it('throws SandboxRunError when docker run fails', async () => {
    execFileSyncMock.mockImplementation(() => {
      const error = new Error('boom');
      (error as any).stderr = Buffer.from('missing docker');
      throw error;
    });

    let thrown: SandboxRunError | null = null;
    try {
      await spawnSandbox('');
    } catch (error) {
      thrown = error as SandboxRunError;
    }

    expect(thrown).toBeInstanceOf(SandboxRunError);
    expect(thrown?.logs[0]).toContain('docker run failed');
  });
});
