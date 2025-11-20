import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const DOCKER_BIN = process.env.AUTOMIGRATE_DOCKER_BIN ?? 'docker';
const DOCKER_IMAGE = process.env.AUTOMIGRATE_DOCKER_IMAGE ?? 'postgres:15';
const POSTGRES_PASSWORD = process.env.AUTOMIGRATE_PG_PASSWORD ?? 'pass';
const HOST_PORT = process.env.AUTOMIGRATE_PG_PORT ?? '54329';
const READY_ATTEMPTS = Number(process.env.AUTOMIGRATE_PG_WAIT_ATTEMPTS ?? '40');
const READY_DELAY_MS = Number(process.env.AUTOMIGRATE_PG_WAIT_MS ?? '500');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class SandboxRunError extends Error {
  logs: string[];

  constructor(message: string, logs: string[] = []) {
    super(message);
    this.name = 'SandboxRunError';
    this.logs = logs;
  }
}

export async function spawnSandbox(migrationSql: string): Promise<string[]> {
  const logs: string[] = [];
  const containerName = `laforge-auto-migrate-${randomUUID()}`;

  try {
    startContainer(containerName, logs);
    await waitForReady(containerName, logs);

    const applyResult = spawnSync(
      DOCKER_BIN,
      ['exec', '-i', containerName, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'],
      {
        input: migrationSql,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    if (applyResult.stdout?.trim()) {
      logs.push(applyResult.stdout.trim());
    }
    if (applyResult.stderr?.trim()) {
      logs.push(applyResult.stderr.trim());
    }
    if (applyResult.status !== 0 && applyResult.status !== null) {
      logs.push(`psql exited with code ${applyResult.status}`);
    }
    if (applyResult.error) {
      logs.push(`psql error: ${applyResult.error.message}`);
    }

    return logs.filter(Boolean);
  } finally {
    stopContainer(containerName);
  }
}

function startContainer(containerName: string, logs: string[]) {
  try {
    execFileSync(DOCKER_BIN, [
      'run',
      '-d',
      '--rm',
      '--name',
      containerName,
      '-e',
      `POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`,
      '-p',
      `${HOST_PORT}:5432`,
      DOCKER_IMAGE,
    ], { stdio: 'pipe' });
  } catch (error) {
    const formatted = formatCommandError('docker run', error);
    logs.push(formatted);
    throw new SandboxRunError('Failed to start Postgres sandbox', logs);
  }
}

async function waitForReady(containerName: string, logs: string[]) {
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt++) {
    try {
      execFileSync(DOCKER_BIN, ['exec', containerName, 'pg_isready', '-U', 'postgres'], { stdio: 'pipe' });
      return;
    } catch {
      if (READY_DELAY_MS > 0) {
        await sleep(READY_DELAY_MS);
      }
    }
  }
  logs.push('Postgres sandbox failed to become ready in time');
  throw new SandboxRunError('Postgres sandbox failed to become ready in time', logs);
}

function stopContainer(containerName: string) {
  try {
    execFileSync(DOCKER_BIN, ['stop', containerName], { stdio: 'ignore' });
  } catch {
    // ignore cleanup errors
  }
}

function formatCommandError(command: string, error: unknown): string {
  if (error && typeof error === 'object' && 'stderr' in error) {
    const stderr = String((error as { stderr?: Buffer }).stderr ?? '').trim();
    if (stderr) {
      return `${command} failed: ${stderr}`;
    }
  }
  return `${command} failed: ${(error as Error)?.message ?? 'unknown error'}`;
}

